#ifndef USERPROG_PROCESS_H
#define USERPROG_PROCESS_H

#include "threads/thread.h"

/* 의존성 추가 */
#include "threads/thread.h"
#include "filesys/off_t.h"

tid_t process_create_initd (const char *file_name);
tid_t process_fork (const char *name, struct intr_frame *if_);
int process_exec (void *f_name);
int process_wait (tid_t);
void process_exit (void);
void process_activate (struct thread *next);

/* 파일 디스크립터 헬퍼 */
int process_add_file (struct file *f);
struct file *process_get_file (int fd);
void process_close_file (int fd);
int process_read_file (struct file *f, void *buffer, unsigned size);

/* 추가 선언: vm용*/
bool install_page (void *upage, void *kpage, bool writable);

/* vm: 추가 구현 구조체 */
struct file;

struct load_info {
	struct file *file;
	off_t ofs;
	uint32_t read_bytes;
	uint32_t zero_bytes;
	bool is_writable;
};

#endif /* userprog/process.h */
