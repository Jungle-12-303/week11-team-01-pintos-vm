/* vm.c: Generic interface for virtual memory objects. */

#include "threads/malloc.h"
#include "vm/vm.h"
#include "vm/inspect.h"

/* 추가된 include들 */
#include "threads/vaddr.h"
#include "lib/kernel/hash.h"

/* Initializes the virtual memory subsystem by invoking each subsystem's
 * intialize codes. */
void
vm_init (void) {
	vm_anon_init ();
	vm_file_init ();
#ifdef EFILESYS  /* For project 4 */
	pagecache_init ();
#endif
	register_inspect_intr ();
	/* DO NOT MODIFY UPPER LINES. */
	/* TODO: Your code goes here. */
}

/* Get the type of the page. This function is useful if you want to know the
 * type of the page after it will be initialized.
 * This function is fully implemented now. */
enum vm_type
page_get_type (struct page *page) {
	int ty = VM_TYPE (page->operations->type);
	switch (ty) {
		case VM_UNINIT:
			return VM_TYPE (page->uninit.type);
		default:
			return ty;
	}
}

/* Helpers */
static struct frame *vm_get_victim (void);
static bool vm_do_claim_page (struct page *page);
static struct frame *vm_evict_frame (void);

/* 추가 구현 헬퍼 함수? */
unsigned page_hash(const struct hash_elem *e, void *aux);
bool page_less(const struct hash_elem *a, const struct hash_elem *b, void *aux);

/* Create the pending page object with initializer. If you want to create a
 * page, do not create it directly and make it through this function or
 * `vm_alloc_page`. */
bool
vm_alloc_page_with_initializer (enum vm_type type, void *upage, bool writable,
		vm_initializer *init, void *aux) {

	ASSERT (VM_TYPE(type) != VM_UNINIT)

	struct supplemental_page_table *spt = &thread_current ()->spt;

	/* Check wheter the upage is already occupied or not. */
	/* 임시: 현재는 ~find_page는 NULL을 반환 */
	if (spt_find_page (spt, upage) == NULL) {
		/* 1. 먼저 페이지를 만들고 공간 할당함 (OS 전용 램 공간) */
		struct page *page = (struct page*)malloc(sizeof(struct page));

		/* 2. switch로 타입별 페이지 생성, 페이지 골격을 uninit로 만듦*/
		switch(VM_TYPE(type)){
			case VM_ANON:
				uninit_new(page, upage, init, type, aux, anon_initializer);
				break;
			default:
				break;
		}

		/* 3. 해당 페이지를 spt 장부에 등록 => 결과 반환 */
		return spt_insert_page(spt, page);
	}
err:
	return false;
}

/* Find VA from spt and return page. On error, return NULL. */
struct page *
spt_find_page (struct supplemental_page_table *spt UNUSED, void *va UNUSED) {
	struct page *page = NULL;
	/* TODO: Fill this function. */

	return page;
}

/* Insert PAGE into spt with validation. */
bool
spt_insert_page (struct supplemental_page_table *spt UNUSED,
		struct page *page UNUSED) {
	int succ = false;
	/* hash를 이용하여 insert한다 */
	struct hash_elem *e = hash_insert (&spt->pages, &page->hash_elem);
	
	/* 이미 있을 경우, 기존 e 값을 반환 */
	if(e == NULL) 
		succ = true;
	
	return succ;
}

void
spt_remove_page (struct supplemental_page_table *spt, struct page *page) {
	vm_dealloc_page (page);
	return true;
}

/* Get the struct frame, that will be evicted. */
static struct frame *
vm_get_victim (void) {
	struct frame *victim = NULL;
	 /* TODO: The policy for eviction is up to you. */

	return victim;
}

/* Evict one page and return the corresponding frame.
 * Return NULL on error.*/
static struct frame *
vm_evict_frame (void) {
	struct frame *victim UNUSED = vm_get_victim ();
	/* TODO: swap out the victim and return the evicted frame. */

	return NULL;
}

/* palloc() and get frame. If there is no available page, evict the page
 * and return it. This always return valid address. That is, if the user pool
 * memory is full, this function evicts the frame to get the available memory
 * space.*/
static struct frame *
vm_get_frame (void) {
	struct frame *frame = NULL;
	/* 먼저 메모리 공간을 할당한다 */
	frame = (struct frame *)malloc(sizeof(struct frame));
	/* 뭔지 모르겠지만 방어코드 */
	ASSERT (frame != NULL);
	ASSERT (frame->page == NULL);
	/*  */

	return frame;
}

/* Growing the stack.
   페이지를 곧바로 만들고 구현한다 */
static void
vm_stack_growth (void *addr UNUSED) {
	/* 1. 주소를 fault_addr => 새 페이지 시작 주소로 정렬 */
	void *rounded_ptr = pg_round_down(addr);
	/* 2. 페이지 생성 (타입 명, 시작 주소, 쓰기 권한) */
	vm_alloc_page(VM_ANON, rounded_ptr, true);
	/* 3. 프레임을 할당하고 MMU로 매핑 */
	vm_claim_page(addr);
}

/* Handle the fault on write_protected page */
static bool
vm_handle_wp (struct page *page UNUSED) {
}

/* Return true on success */
bool
vm_try_handle_fault (struct intr_frame *f UNUSED, void *addr UNUSED,
		bool user UNUSED, bool write UNUSED, bool not_present UNUSED) {
	struct supplemental_page_table *spt UNUSED = &thread_current ()->spt;
	struct page *page = NULL;
	/* 먼저 validation을 수행한다
	   case 1: 커널 영역을 건들면 아웃
	   case 2: 메모리는 충분히 있는데 다른 이유로 터졌으니 아웃 */
	if(!is_user_vaddr(addr)) return false;
	if(!not_present) return false;
	
	/* 여기에 분기를 구현한다
	   case 1: 이미 장부에 page가 존재한다면? => 잠자고 있는거 반환
	   case 2: 장부에도 없는 새 page라면? => 새로 만들고 반환 */
	// if(spt_find_page(spt, addr)){
	// 	return vm_claim_page(addr);
	// }else{
		vm_stack_growth(addr);
	// }
	
	return vm_do_claim_page (page);
}

/* Free the page.
 * DO NOT MODIFY THIS FUNCTION. */
void
vm_dealloc_page (struct page *page) {
	destroy (page);
	free (page);
}

/* Claim the page that allocate on VA. */
bool
vm_claim_page (void *va UNUSED) {
	struct page *page = NULL;
	/* TODO: Fill this function */

	return vm_do_claim_page (page);
}

/* Claim the PAGE and set up the mmu. */
static bool
vm_do_claim_page (struct page *page) {
	struct frame *frame = vm_get_frame ();

	/* Set links */
	frame->page = page;
	page->frame = frame;

	/* TODO: Insert page table entry to map page's VA to frame's PA. */

	return swap_in (page, frame->kva);
}

/* Initialize new supplemental page table */
void
supplemental_page_table_init (struct supplemental_page_table *spt UNUSED) {
	/* 안에 있는 hash table도 init한다 */
	hash_init(&spt->pages, page_hash, page_less, NULL);
}

/* Copy supplemental page table from src to dst */
bool
supplemental_page_table_copy (struct supplemental_page_table *dst UNUSED,
		struct supplemental_page_table *src UNUSED) {
}

/* Free the resource hold by the supplemental page table */
void
supplemental_page_table_kill (struct supplemental_page_table *spt UNUSED) {
	/* TODO: Destroy all the supplemental_page_table hold by thread and
	 * TODO: writeback all the modified contents to the storage. */
}

/* hash_page init을 위한 추가 구현부입니다 */
unsigned page_hash(const struct hash_elem *e, void *aux){
	struct page *p = hash_entry(e, struct page, hash_elem);
	/* 주소 => 숫자로 변환 */
	return hash_int(p->va);
}

bool page_less(const struct hash_elem *a, const struct hash_elem *b, void *aux){
	struct page *pa = hash_entry(a, struct page, hash_elem);
	struct page *pb = hash_entry(b, struct page, hash_elem);
	/* 오름차순 구현: 페이지의 시작 addr를 기준으로 */
	return pa->va < pb->va;
}