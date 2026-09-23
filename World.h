#pragma once
#include <deque>
#include <utility>
#include <vector>
#include "world_ptr.h"
#include "Arena.h"

class World
{
private:
	Arena arena;
	// std::deque never moves existing elements on push_back, so the Record*
	// held by world_ptr stays valid (a std::vector would reallocate and leave
	// every handle dangling after the next spawn)
	std::deque<Record> records;
	std::vector<size_t> freeSlots;

	void release(Record& rec, const char* reason) {
		std::size_t offset = arena.offset_of(rec.object);
		rec.destroy(rec.object);
		arena.unregister_destructor(rec.object);
		rec.alive = false;
		rec.object = nullptr;
		rec.refCount = 0;
		rec.generation++; // every existing handle to this slot is now stale
		freeSlots.push_back(rec.slot);
		trace::emit("world_release", trace::Json().kv("slot", rec.slot).kv("gen", rec.generation)
			.kv("offset", offset).kv("reason", reason));
	}

public:
	World() : arena(1024, "world") {}
	~World() { arena.reset(); }

	template<class T, class... Args>
	world_ptr<T> spawn(Args&&... args) {
		T* obj = arena.create<T>(std::forward<Args>(args)...);
		if (!obj) return world_ptr<T>(nullptr);

		Record* rec;
		if (!freeSlots.empty()) {
			rec = &records[freeSlots.back()];
			freeSlots.pop_back();
		}
		else {
			records.push_back(Record{});
			rec = &records.back();
			rec->slot = records.size() - 1;
		}
		rec->object = obj;
		rec->refCount = 1;
		rec->destroy = [](void* p) {static_cast<T*>(p)->~T(); };
		rec->alive = true;

		trace::emit("world_spawn", trace::Json().kv("slot", rec->slot).kv("gen", rec->generation)
			.kv("offset", arena.offset_of(obj)).kv("size", sizeof(T)).kv("label", trace_label(*obj)));
		return world_ptr<T>(rec);
	}

	// Destroy an object right now, even if handles still point at it.
	// Those handles become stale and refuse to dereference.
	template<class T>
	bool kill(const world_ptr<T>& handle) {
		if (!handle.valid()) return false;
		release(*handle.record_, "kill");
		return true;
	}

	void collect() {
		trace::emit("world_collect_begin", trace::Json());
		for (auto& rec : records) {
			if (rec.alive && rec.refCount == 0) {
				release(rec, "collect");
			}
		}
		trace::emit("world_collect_end", trace::Json().kv("arena_used", arena.used()));
	}
};
