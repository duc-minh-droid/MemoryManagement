#pragma once
#include <cstddef>
#include <string>
#include <utility>
#include <vector>
#include "Trace.h"

struct Destructor {
	void* ptr;
	void (*destroy)(void*);
};

class Arena
{
private:
	std::size_t cap_; // total size in bytes
	char* buffer_; // start of arena
	char* offset_; // next free byte
	std::vector<Destructor> destructors_;
	std::string name_; // only used for tracing
public:
	Arena(std::size_t cap, std::string name = "arena") : cap_(cap), name_(std::move(name)) {
		buffer_ = static_cast<char*>(::operator new(cap_));
		offset_ = buffer_;
		trace::emit("arena_create", trace::Json().kv("arena", name_).kv("cap", cap_));
	}
	~Arena() {
		reset();
		::operator delete(buffer_);
	}
	Arena(const Arena&) = delete;
	Arena& operator=(const Arena&) = delete;

	template<class T, class... Args>
	T* create(Args&&... args) {
		// work out padding for alignment without moving the pointer yet,
		// so a failed allocation leaves the arena untouched
		std::size_t used = offset_ - buffer_; // pointer arithmetic: bytes handed out so far
		std::size_t pad = 0;
		while (reinterpret_cast<std::size_t>(offset_ + pad) % alignof(T) != 0) {
			++pad;
		}

		// check space if have enough remaining space
		if (pad + sizeof(T) > cap_ - used) {
			trace::emit("arena_oom", trace::Json().kv("arena", name_).kv("offset", used)
				.kv("size", sizeof(T)).kv("pad", pad).kv("kind", trace_kind(trace::type_tag<T>{})));
			return nullptr;
		}
		offset_ += pad;

		// construct
		T* obj = new (offset_) T(std::forward<Args>(args)...);

		// advance pointer
		offset_ += sizeof(T);

		// register destructor
		destructors_.push_back({
			obj,
			[](void* p) {static_cast<T*>(p)->~T(); }
		});

		trace::emit("arena_alloc", trace::Json().kv("arena", name_)
			.kv("offset", used + pad).kv("pad", pad).kv("size", sizeof(T)).kv("align", alignof(T))
			.kv("top", static_cast<std::size_t>(offset_ - buffer_))
			.kv("kind", trace_kind(trace::type_tag<T>{})).kv("label", trace_label(*obj)));
		return obj;
	}

	void reset() {
		if (offset_ == buffer_ && destructors_.empty()) return;
		trace::emit("arena_reset_begin", trace::Json().kv("arena", name_).kv("objects", destructors_.size()));
		for (auto it = destructors_.rbegin(); it != destructors_.rend(); ++it) {
			it->destroy(it->ptr);
		}
		// forget the destructors we just ran, otherwise a second reset() (e.g. from
		// ~Arena after a manual reset) would destroy the same objects twice
		destructors_.clear();
		offset_ = buffer_;
		trace::emit("arena_reset", trace::Json().kv("arena", name_));
	}

	void unregister_destructor(void* ptr) {
		for (auto it = destructors_.begin(); it != destructors_.end(); ++it) {
			if (it->ptr == ptr) {
				destructors_.erase(it);
				// the bytes stay reserved until reset(): an arena never frees in the middle
				trace::emit("arena_release", trace::Json().kv("arena", name_).kv("offset", offset_of(ptr)));
				return;
			}
		}
	}

	std::size_t offset_of(const void* ptr) const {
		return static_cast<const char*>(ptr) - buffer_;
	}
	std::size_t used() const { return offset_ - buffer_; }
	std::size_t capacity() const { return cap_; }
};
