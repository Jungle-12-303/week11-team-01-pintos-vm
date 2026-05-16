#include "userprog/syscall.h"
#include <stdio.h>
#include <syscall-nr.h>
#include "threads/interrupt.h"
#include "threads/thread.h"
#include "threads/loader.h"
#include "userprog/gdt.h"
#include "threads/flags.h"
#include "intrinsic.h"

/* 추가 임포트 */
#include "lib/string.h"
#include "devices/input.h"
#include "threads/init.h"
#include "threads/palloc.h"
#include "threads/synch.h"
#include "threads/vaddr.h"
#include "threads/mmu.h"
#include "userprog/process.h"
#include "filesys/filesys.h"
#include "filesys/file.h"
#include "vm/vm.h"


#define FD_MAX (PGSIZE / sizeof (struct file *))

void syscall_entry (void);
void syscall_handler (struct intr_frame *);

/* 추가 함수들 */
void halt (void);
void exit (int status);
tid_t fork (const char *thread_name, struct intr_frame *f);
int exec (const char *cmd_line);
int write (int fd, const void *buffer, unsigned size, void *rsp);
int read (int fd, void *buffer, unsigned size, void *rsp);
bool create (const char *file, unsigned initial_size);
int open (const char *file);
void close (int fd);
void seek (int fd, unsigned position);

void check_address (const void *addr);
static void check_user_buffer (const void *buffer, unsigned size);
static void check_user_string (const char *str);
static void check_page_growth (const void *buffer, unsigned size, 
							   bool need_write, void *rsp);

/* 추가 변수들 */
struct lock filesys_lock;

/*
 * 시스템 콜.
 *
 * 이전에는 시스템 콜 서비스가 인터럽트 핸들러
 * (예: Linux의 int 0x80)로 처리되었다. 하지만 x86-64에서는
 * 제조사가 `syscall` 명령어라는 더 효율적인 시스템 콜 요청 경로를 제공한다.
 *
 * syscall 명령어는 Model Specific Register(MSR)에 저장된 값을 읽어 동작한다.
 * 자세한 내용은 매뉴얼을 참고하라.
 */

/*
 * 세그먼트 셀렉터 MSR.
 */
#define MSR_STAR 0xc0000081
/*
 * Long mode SYSCALL 대상.
 */
#define MSR_LSTAR 0xc0000082
/*
 * eflags용 마스크.
 */
#define MSR_SYSCALL_MASK 0xc0000084

void
syscall_init (void) {
	write_msr (MSR_STAR, ((uint64_t) SEL_UCSEG - 0x10) << 48 |
	                             ((uint64_t) SEL_KCSEG) << 32);
	write_msr (MSR_LSTAR, (uint64_t) syscall_entry);

	/*
	 * 인터럽트 서비스 루틴은 syscall_entry가 유저랜드 스택을 커널 모드
	 * 스택으로 교체하기 전까지 어떤 인터럽트도 처리해서는 안 된다. 따라서
	 * FLAG_FL을 마스킹했다.
	 */
	write_msr (MSR_SYSCALL_MASK,
	           FLAG_IF | FLAG_TF | FLAG_DF | FLAG_IOPL | FLAG_AC | FLAG_NT);

	/* 추가 초기화 */
	lock_init (&filesys_lock);
}

/*
 * 메인 시스템 콜 인터페이스.
 */
void
syscall_handler (struct intr_frame *f UNUSED) {
	switch (f->R.rax) {
	case SYS_HALT:
		halt ();
		break;
	case SYS_FORK:
		f->R.rax = fork ((const char *) f->R.rdi, f);
		break;
	case SYS_WAIT:
		f->R.rax = process_wait ((tid_t) f->R.rdi);
		break;
	case SYS_EXEC:
		f->R.rax = exec ((const char *) f->R.rdi);
		break;
	case SYS_READ:
		f->R.rax = read (f->R.rdi, (void *) f->R.rsi, f->R.rdx, f->rsp);
		break;
	case SYS_WRITE:
		/* fd, buffer, size를 전달받는다. */
		f->R.rax = write (f->R.rdi, (const void *) f->R.rsi, f->R.rdx, f->rsp);
		break;
	case SYS_EXIT:
		/* 종료 상태값 받음 */
		exit (f->R.rdi);
		break;
	case SYS_CREATE:
		f->R.rax = create ((const char *) f->R.rdi, f->R.rsi);
		break;
	case SYS_OPEN:
		f->R.rax = open ((const char *) f->R.rdi);
		break;
	case SYS_CLOSE:
		close (f->R.rdi);
		break;
	case SYS_FILESIZE:
		f->R.rax = filesize(f->R.rdi);
		break;
	case SYS_SEEK:
		seek(f->R.rdi, f->R.rsi);
		break;
	default:
		break;
	}
}

/* 구현 명령어들 */
/* 시스템 전체 셧다운 */
void
halt (void) {
	power_off ();
}

tid_t
fork (const char *thread_name, struct intr_frame *if_) {
	check_address (thread_name);
	return process_fork (thread_name, if_);
}

int
exec (const char *cmd_line) {
	char *cmd_copy;
	int status;

	check_user_string (cmd_line);

	cmd_copy = palloc_get_page (0);
	if (cmd_copy == NULL)
		exit (-1);

	strlcpy (cmd_copy, cmd_line, PGSIZE);
	status = process_exec (cmd_copy);
	if (status < 0)
		exit (-1);
	return status;
}

void
exit (int status) {
	struct thread *curr = thread_current ();

	if (curr == NULL)
		thread_exit ();

	printf ("%s: exit(%d)\n", curr->name, status);
	if (curr->self_status != NULL)
		curr->self_status->exit_status = status;
	thread_exit ();
}

int
write (int fd, const void *buffer, unsigned size, void *rsp) {
	int write_result;
	struct file *file;

	/* 유효성 검사 */
	check_user_buffer (buffer, size);
	check_page_growth(buffer, size, false, rsp);

	/* 락 획득: 동시에 읽어서 꼬임 방지*/
	lock_acquire (&filesys_lock);

	/* 명령: 화면에 출력하라 */
	if (fd == 1) {
		putbuf (buffer, size);
		write_result = size;
	}
	/* 명령: 기타... */
	else {
		file = process_get_file (fd);
		write_result = file == NULL ? -1 : file_write (file, buffer, size);
	}

	/* 락 해제: 이제 읽을 필요 없음 */
	lock_release (&filesys_lock);

	return write_result;
}

bool
create (const char *file, unsigned initial_size) {
	bool result;

	check_address ((void *) file);
	check_user_string(file);

	lock_acquire (&filesys_lock);
	result = filesys_create (file, initial_size);
	lock_release (&filesys_lock);
	return result;
}

int
open (const char *file) {
	struct file *opened_file;
	int fd;

	check_address ((void *) file);
	check_user_string(file);
	lock_acquire (&filesys_lock);

	// 열린 파일 객체의 주소
	opened_file = filesys_open (file);

	if (opened_file == NULL) {
		lock_release (&filesys_lock);
		return -1;
	}

	// 열린 파일 f를 fd테이블 빈칸에 넣고, 그 칸 번호를 돌려준다
	fd = process_add_file (opened_file);
	if (fd == -1)
		file_close (opened_file);
	lock_release (&filesys_lock);
	return fd;
}

void
close (int fd) {
	lock_acquire (&filesys_lock);
	process_close_file (fd);
	lock_release (&filesys_lock);
}

int
read (int fd, void *buffer, unsigned size, void *rsp) {
	int type_size = 0;
	uint8_t *buf = (uint8_t *) buffer;

	/* 예외처리 코드.. 사실 너무 누더기가 되었다 */
	check_address (buffer);
	check_user_buffer(buffer, size);
	check_page_growth(buffer, size, true, rsp);
	
	lock_acquire (&filesys_lock);
	struct file *f = process_get_file (fd);
	if (f == NULL) {
		lock_release (&filesys_lock);
		return -1;
	}

	if (fd == 0) {
		while (type_size < size) {
			buf[type_size] = input_getc ();

			if (buf[type_size] == '\n')
				break;
			type_size++;
		}

		lock_release (&filesys_lock);
		return type_size;
	} else {
		off_t s = file_read (f, buffer, size);
		lock_release (&filesys_lock);
		return s;
	}
}

unsigned
tell (int fd) {
	struct file *f = process_get_file (fd);
	return file_tell (f);
}

int
filesize (int fd) {
	struct file *f = process_get_file (fd);
	return file_length (f);
}

bool
remove (const char *file) {
	return filesys_remove (file);
}

void
seek (int fd, unsigned position) {
	struct file *f = process_get_file (fd);
	file_seek (f, position);
}

/* 여기서부턴 헬퍼 함수 기술 */
/* 유효성 검사 */
void
check_address (const void *addr) {
	struct thread *curr = thread_current ();

	/* 애초에 없다면? */
	if (addr == NULL) {
		exit (-1);
	}

	if (curr == NULL || curr->pml4 == NULL)
		exit (-1);

	/* 커널 영역 침범 여부 */
	if (!is_user_vaddr (addr)) {
		exit (-1);
	}
}

static void
check_user_buffer (const void *buffer, unsigned size) {
	struct supplemental_page_table *spt = &thread_current()->spt;
	const char *addr = buffer;
	uintptr_t start;
	uintptr_t end;

	if (size == 0)
		return;

	// struct page *page = spt_find_page(spt, addr);
	// if (page == NULL)
	// 	exit(-1);

	check_address (buffer);
	check_address (addr + size - 1);

	start = (uintptr_t) pg_round_down (addr);
	end = (uintptr_t) pg_round_down (addr + size - 1);
	for (; start <= end; start += PGSIZE)
		check_address ((const void *) start);
}

static void
check_user_string (const char *str) {
	struct supplemental_page_table *spt = &thread_current()->spt;
	struct page *page = spt_find_page(spt, str);
	if (page == NULL)
		exit(-1);
	
	while (true) {
		/* 주소값 하나: 1바이트 씩 검사 */
		check_address (str);
		if (*str == '\0')
			return;
		str++;
	}
}

static void 
check_page_growth (const void *buffer, unsigned size, bool need_write, void *rsp){
	struct supplemental_page_table *spt = &thread_current()->spt;

	char *ptr = pg_round_down(buffer);
	char *end = (char *)buffer + size;

	/* writable한지 권한 알아보기: 순회하면서 
	   1. 페이지가 없다면? => 유저 영역 내라면 확장 
	   2. 페이지가 있는데 writable이 아니라면? => exit(-1) */
	while(ptr < end){
		struct page *page = spt_find_page(spt, ptr);
		void *check_addr;
		
		if (ptr == pg_round_down(buffer))
			check_addr = (void *) buffer;
		else
			check_addr = ptr;
		
		
		if(page == NULL){
			if(is_user_vaddr(check_addr) &&
			    check_addr >= rsp - 32 && 
				check_addr < USER_STACK)
				vm_stack_growth(ptr);
			else
				exit(-1);
		}
		else {
			if(need_write && page->is_writable == false)
				exit(-1);

			if(page->frame == NULL)
				vm_claim_page(ptr);
		}

		ptr += PGSIZE;
	}
}
