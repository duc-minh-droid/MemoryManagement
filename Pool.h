#pragma once
#include <utility>

template<class T, size_t N>
class Pool
{
private:
	unsigned char* buffer_;
	size_t freeCount_;
	size_t freeList_[N];
public:
	Pool() : freeCount_(N) {
		buffer_ = static_cast<unsigned char*>( ::operator new( sizeof(T) * N ) );
		for (size_t i = 0; i < N; i++) {
			freeList_[i] = i;
		}
	}

	~Pool() {
		::operator delete(buffer_);
	}

	template<class... Args>
	T* create(Args&&... args) {
		if (freeCount_ == 0) return nullptr;

		size_t index = freeList_[--freeCount_];
		auto address = buffer_ + index * sizeof(T);

		T* obj = new (address) T(std::forward<Args>(args)...);

		return obj;
	}

	void destroy(T* ptr) {
		ptr->~T();
		size_t index = (reinterpret_cast<unsigned char*>(ptr) - buffer_) / sizeof(T);
		freeList_[freeCount_++] = index;
	}
};

