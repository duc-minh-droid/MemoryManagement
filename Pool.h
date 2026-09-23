#pragma once
#include <cstddef>
#include <string>
#include <utility>
#include "Trace.h"

template<class T, size_t N>
class Pool
{
private:
	unsigned char* buffer_;
	size_t freeCount_;
	size_t freeList_[N]; // stack of free slot indices, top = freeList_[freeCount_ - 1]
	bool live_[N];       // which slots hold a constructed object
	std::string name_;   // only used for tracing

	// free list in the order create() will hand slots out (top of stack first)
	void trace_state(const char* type, size_t slot, const std::string& label) const {
		if (!trace::on()) return;
		size_t order[N > 0 ? N : 1];
		for (size_t i = 0; i < freeCount_; ++i) order[i] = freeList_[freeCount_ - 1 - i];
		trace::emit(type, trace::Json().kv("pool", name_).kv("slot", slot)
			.kv("offset", slot * sizeof(T)).kv("label", label)
			.list("free", order, freeCount_));
	}
public:
	Pool(std::string name = "pool") : freeCount_(N), name_(std::move(name)) {
		buffer_ = static_cast<unsigned char*>( ::operator new( sizeof(T) * N ) );
		for (size_t i = 0; i < N; i++) {
			// push in reverse so slot 0 is handed out first
			freeList_[i] = N - 1 - i;
			live_[i] = false;
		}
		if (trace::on()) {
			size_t order[N > 0 ? N : 1];
			for (size_t i = 0; i < N; ++i) order[i] = i;
			trace::emit("pool_create", trace::Json().kv("pool", name_).kv("slots", N)
				.kv("slot_size", sizeof(T)).kv("kind", trace_kind(trace::type_tag<T>{}))
				.list("free", order, N));
		}
	}

	~Pool() {
		// destroy anything still alive, otherwise their destructors never run
		for (size_t i = 0; i < N; i++) {
			if (live_[i]) destroy(reinterpret_cast<T*>(buffer_ + i * sizeof(T)));
		}
		::operator delete(buffer_);
	}
	Pool(const Pool&) = delete;
	Pool& operator=(const Pool&) = delete;

	template<class... Args>
	T* create(Args&&... args) {
		if (freeCount_ == 0) {
			trace::emit("pool_full", trace::Json().kv("pool", name_));
			return nullptr;
		}

		size_t index = freeList_[--freeCount_];
		auto address = buffer_ + index * sizeof(T);

		T* obj = new (address) T(std::forward<Args>(args)...);
		live_[index] = true;

		trace_state("pool_alloc", index, trace_label(*obj));
		return obj;
	}

	void destroy(T* ptr) {
		if (!ptr) return;
		size_t index = (reinterpret_cast<unsigned char*>(ptr) - buffer_) / sizeof(T);
		if (!live_[index]) {
			// double free: the slot is already on the free list, pushing it again
			// would hand the same memory to two objects later
			trace_state("pool_double_free", index, "");
			return;
		}
		std::string label = trace::on() ? trace_label(*ptr) : std::string();
		ptr->~T();
		live_[index] = false;
		freeList_[freeCount_++] = index;
		trace_state("pool_free", index, label);
	}

	size_t slot_of(const T* ptr) const {
		return (reinterpret_cast<const unsigned char*>(ptr) - buffer_) / sizeof(T);
	}
};
