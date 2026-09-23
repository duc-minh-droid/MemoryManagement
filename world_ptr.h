#pragma once
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include "Trace.h"

// One slot in the World's record table. Slots are reused; every time an object
// in a slot dies the generation is bumped, so old handles can tell they are stale.
struct Record {
	void* object;
	size_t refCount;
	void (*destroy)(void*);
	bool alive = false;
	std::uint32_t generation = 1;
	size_t slot = 0;
};

class dangling_world_ptr : public std::runtime_error {
public:
	dangling_world_ptr() : std::runtime_error("dereferenced a world_ptr whose object is gone") {}
};

inline unsigned next_handle_id() {
	static unsigned id = 0;
	return ++id;
}

template<class T>
class world_ptr
{
	friend class World;
private:
	Record* record_;
	std::uint32_t generation_; // generation of the slot when this handle was made
	unsigned id_;              // only used for tracing

	world_ptr() : record_(nullptr), generation_(0), id_(next_handle_id()) {}
	world_ptr(Record* record)
		: record_(record), generation_(record ? record->generation : 0), id_(next_handle_id()) {
		if (record_) trace_handle("handle_new", 0);
	}

	bool valid() const {
		return record_ && record_->alive && record_->generation == generation_;
	}

	void trace_handle(const char* type, unsigned from) const {
		if (!trace::on() || !record_) return;
		trace::Json j;
		j.kv("handle", id_).kv("slot", record_->slot).kv("gen", generation_)
			.kv("slot_gen", record_->generation).kv("refs", record_->refCount).kv("valid", valid());
		if (from) j.kv("from", from);
		trace::emit(type, j);
	}

	void release() {
		if (!record_) return;
		// a stale handle must not touch the refcount: the slot may belong to a new object now
		if (valid()) --record_->refCount;
		trace_handle("handle_drop", 0);
	}
public:
	world_ptr(const world_ptr& other)
		: record_(other.record_), generation_(other.generation_), id_(next_handle_id()) {
		if (valid()) {
			record_->refCount++;
		}
		trace_handle("handle_copy", other.id_);
	}
	world_ptr& operator=(const world_ptr& other) {
		if (this == &other) return *this;
		release();
		record_ = other.record_;
		generation_ = other.generation_;
		if (valid()) record_->refCount++;
		trace_handle("handle_copy", other.id_);
		return *this;
	}
	~world_ptr() {
		release();
	}

	// true while the object this handle was made for is still alive
	bool alive() const { return valid(); }

	// nullptr if the object has been collected or killed
	T* get() const {
		return valid() ? static_cast<T*>(record_->object) : nullptr;
	}

	T* operator->() const {
		if (!valid()) {
			trace_handle("stale_access", 0);
			throw dangling_world_ptr();
		}
		return static_cast<T*>(record_->object);
	}

	unsigned id() const { return id_; }
};
