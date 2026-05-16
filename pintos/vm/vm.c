/* vm.c: Generic interface for virtual memory objects. */

#include "threads/malloc.h"
#include "vm/vm.h"
#include "vm/inspect.h"
#include "lib/kernel/hash.h"
#include "threads/vaddr.h"
#include "threads/mmu.h"
#include "userprog/process.h"
#include "filesys/file.h"
#include "string.h"

/* Initializes the virtual memory subsystem by invoking each subsystem's
 * intialize codes. */
void
vm_init (void) {
	vm_anon_init ();
	vm_file_init ();
#ifdef EFILESYS /* For project 4 */
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
static void lazy_load_aux_destroy (void *aux);
static void *lazy_load_aux_copy (void *aux);

/* Create the pending page object with initializer. If you want to create a
 * page, do not create it directly and make it through this function or
 * `vm_alloc_page`. */
bool
vm_alloc_page_with_initializer (enum vm_type type, void *upage, bool writable, vm_initializer *init, void *aux) {
	ASSERT (VM_TYPE (type) != VM_UNINIT);
	ASSERT (pg_round_down (upage) == upage);

	struct supplemental_page_table *spt = &thread_current ()->spt;

	/* Check wheter the upage is already occupied or not. */
	if (spt_find_page (spt, upage) == NULL) {
		struct page *page = malloc (sizeof (struct page));

		switch (VM_TYPE (type)) {
		case VM_ANON:
			uninit_new (page, upage, init, type, aux, &anon_initializer);
			break;
		case VM_FILE:
			uninit_new (page, upage, init, type, aux, &file_backed_initializer);
			break;

		default:
			free (page);
			return false;
		}

		page->writable = writable;

		if (!spt_insert_page (spt, page)) {
			free (page);
			return false;
		}
		return true;
	}
	return false;
}

/* Find VA from spt and return page. On error, return NULL. */
struct page *
spt_find_page (struct supplemental_page_table *spt, void *va) {
	struct page page;
	struct hash_elem *elem = NULL;

	page.va = pg_round_down (va);
	elem = hash_find (&spt->spt_entry, &page.hash_elem);

	if (elem == NULL)
		return NULL;

	return hash_entry (elem, struct page, hash_elem);
}

/* Insert PAGE into spt with validation. */
bool
spt_insert_page (struct supplemental_page_table *spt,
                 struct page *page) {
	if (hash_insert (&spt->spt_entry, &page->hash_elem) == NULL)
		return true;
	else
		return false;
}

void
spt_remove_page (struct supplemental_page_table *spt, struct page *page) {
	hash_delete (&spt->spt_entry, &page->hash_elem);
	vm_dealloc_page (page);
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
	struct frame *frame = (struct frame *) malloc (sizeof (struct frame)); // 함수가 종료되어도 사라지지 않는 메모리 공간을 할당해서 프레임을 설정해라
	if (frame == NULL)
		PANIC ("todo");

	frame->kva = palloc_get_page (PAL_USER);
	if (frame->kva == NULL)
		PANIC ("todo");

	frame->page = NULL;

	return frame;
}

/* Growing the stack. */
static bool
vm_stack_growth (void *addr) {
	void *upage = pg_round_down (addr);
	return vm_alloc_page (VM_ANON | VM_MARKER_0, upage, true) &&
	       vm_claim_page (upage);
}

/* Handle the fault on write_protected page */
static bool
vm_handle_wp (struct page *page UNUSED) {
	return false;
}

/* Return true on success */
bool
vm_try_handle_fault (struct intr_frame *f, void *addr,
                     bool user UNUSED, bool write, bool not_present) {
	struct supplemental_page_table *spt = &thread_current ()->spt;
	struct page *page = NULL;
	void *page_addr;

	if (addr == NULL || !is_user_vaddr (addr))
		return false;

	if (!not_present)
		return false;

	page_addr = pg_round_down (addr);
	page = spt_find_page (spt, page_addr);
	if (page == NULL) {
		uint64_t fault_addr = (uint64_t) addr;

		if (fault_addr < (uint64_t) USER_STACK &&
		    fault_addr >= (uint64_t) USER_STACK - (1 << 20) &&
		    fault_addr >= f->rsp - 8)
			return vm_stack_growth (page_addr);
		return false;
	}

	if (write && !page->writable)
		return false;

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
vm_claim_page (void *va) {
	struct page *page = NULL;
	struct supplemental_page_table *spt = &thread_current ()->spt;

	page = spt_find_page (spt, va);

	if (page == NULL) {
		return false;
	}
	return vm_do_claim_page (page);
}

/* Claim the PAGE and set up the mmu. */
static bool
vm_do_claim_page (struct page *page) {
	struct frame *frame = vm_get_frame ();

	if (frame == NULL) {
		return false;
	}

	/* Set links */
	frame->page = page;
	page->frame = frame;

	if (!pml4_set_page (thread_current ()->pml4, page->va, frame->kva, page->writable)) {
		palloc_free_page (frame->kva);
		free (frame);
		page->frame = NULL;

		return false;
	};

	if (!swap_in (page, frame->kva)) {
		pml4_clear_page (thread_current ()->pml4, page->va);
		palloc_free_page (frame->kva);
		free (frame);
		page->frame = NULL;
		return false;
	}

	return true;
}

/* Returns a hash value for page p. */
uint64_t
page_hash (const struct hash_elem *p_, void *aux UNUSED) {
	const struct page *p = hash_entry (p_, struct page, hash_elem);
	return hash_bytes (&p->va, sizeof p->va);
}

/* Returns true if page a precedes page b. */
bool
page_less (const struct hash_elem *a_,
           const struct hash_elem *b_, void *aux UNUSED) {
	const struct page *a = hash_entry (a_, struct page, hash_elem);
	const struct page *b = hash_entry (b_, struct page, hash_elem);

	return a->va < b->va;
}

/* Initialize new supplemental page table */
void
supplemental_page_table_init (struct supplemental_page_table *spt) {
	hash_init (&spt->spt_entry, page_hash, page_less, NULL);
}

/* Copy supplemental page table from src to dst */
bool
supplemental_page_table_copy (struct supplemental_page_table *dst UNUSED,
                              struct supplemental_page_table *src UNUSED) {
	struct hash_iterator i;
	hash_first (&i, &src->spt_entry);
	while (hash_next (&i)) {
		struct page *src_page = hash_entry (hash_cur (&i), struct page, hash_elem);
		enum vm_type vmtype = page_get_type (src_page);

		if (src_page->operations->type == VM_UNINIT) {
			void *aux = lazy_load_aux_copy (src_page->uninit.aux);
			if (src_page->uninit.aux != NULL && aux == NULL)
				return false;

			if (!vm_alloc_page_with_initializer (src_page->uninit.type,
			                                     src_page->va,
			                                     src_page->writable,
			                                     src_page->uninit.init,
			                                     aux)) {
				lazy_load_aux_destroy (aux);
				return false;
			}

			if (!vm_claim_page (src_page->va))
				return false;

			continue;
		}

		if (!vm_alloc_page (vmtype, src_page->va, src_page->writable)) {
			return false;
		}

		if (!vm_claim_page (src_page->va)) {
			return false;
		}
		struct page *dst_page = spt_find_page (dst, src_page->va);
		if (dst_page == NULL || dst_page->frame == NULL ||
		    src_page->frame == NULL) {
			return false;
		}
		memcpy (dst_page->frame->kva, src_page->frame->kva, PGSIZE);
	}
	return true;
}

static void *
lazy_load_aux_copy (void *aux) {
	if (aux == NULL)
		return NULL;

	struct lazy_load_aux *src = aux;
	struct lazy_load_aux *dst = malloc (sizeof *dst);
	if (dst == NULL)
		return NULL;

	*dst = *src;
	if (src->file != NULL) {
		dst->file = file_reopen (src->file);
		if (dst->file == NULL) {
			free (dst);
			return NULL;
		}
	}
	return dst;
}

static void
lazy_load_aux_destroy (void *aux) {
	if (aux == NULL)
		return;

	struct lazy_load_aux *lazy_aux = aux;
	if (lazy_aux->file != NULL)
		file_close (lazy_aux->file);
	free (lazy_aux);
}

static void
destroy_page (struct hash_elem *e, void *aux UNUSED) {
	struct page *page = hash_entry (e, struct page, hash_elem);
	vm_dealloc_page (page);
}

/* Free the resource hold by the supplemental page table */
void
supplemental_page_table_kill (struct supplemental_page_table *spt) {
	hash_destroy (&spt->spt_entry, &destroy_page);
}
