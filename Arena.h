#pragma once
#include <cstddef>
#include <utility>
#include <vector>

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
public:
	Arena(std::size_t cap) : cap_(cap) {
		buffer_ = static_cast<char*>(::operator new(cap_));
		offset_ = buffer_;
	}
	~Arena() {
		reset();
		::operator delete(buffer_);
	}

	template<class T, class... Args>
	T* create(Args&&... args) {
		// add padding for alignment
		while (reinterpret_cast<std::size_t>(offset_) % alignof(T) != 0) {
			++offset_;
		}

		// check space if have enough remaining space
		std::size_t used = offset_ - buffer_; // pointer arithmetic: returns space available between a and b
		if (sizeof(T) > cap_ - used) {
			return nullptr;
		}

		// construct
		T* obj = new (offset_) T(std::forward<Args>(args)...);

		// advance pointer
		offset_ += sizeof(T);

		// register destructor
		destructors_.push_back({
			obj,
			[](void* p) {static_cast<T*>(p)->~T(); }
		});

		return obj;
	}

	void reset() {
		for (auto it = destructors_.rbegin(); it != destructors_.rend(); ++it) {
			it->destroy(it->ptr);
		}
		offset_ = buffer_;
	}

	void unregister_destructor(void* ptr) {
		for (auto it = destructors_.begin(); it != destructors_.end(); ++it) {
			if (it->ptr == ptr) {
				destructors_.erase(it);
				return;
			}
		}
	};
};