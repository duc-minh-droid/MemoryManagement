#pragma once

struct Record {
	void* object;
	size_t refCount;
	void (*destroy)(void*);
	bool destroyed = false;
};

template<class T>
class world_ptr
{
	friend class World;
private:
	Record* record_;
	world_ptr() : record_(nullptr) {}
	world_ptr(Record* record) : record_(record) {}
public:
	world_ptr(const world_ptr& other) : record_(other.record_) {
		if (record_) {
			record_->refCount++;
		}
	}
	~world_ptr() {
		if (record_) {
			--record_->refCount;
		}
	}
	T* operator->() {
		return static_cast<T*>(record_->object);
	}
};

