#pragma once
#include <utility>
#include "world_ptr.h"
#include "Arena.h"

class World
{
private:
	Arena arena;
	std::vector<Record> records;

public:
	World() : arena(1024) {}
	~World() { arena.reset(); }

	template<class T, class... Args>
	world_ptr<T> spawn(Args&&... args) {
		T* obj = arena.create<T>(std::forward<Args>(args)...);
		Record record{ obj, 1, 
			[](void* p) {static_cast<T*>(p)->~T(); } 
		};
		records.push_back(record);
		return world_ptr<T>(&records[records.size()-1]);
	}

	void collect() {
		for (auto it = records.begin(); it != records.end(); ) {
			if (it->refCount == 0 && !it->destroyed) {
				it->destroy(it->object);
				it->destroyed = true;
				arena.unregister_destructor(it->object);
				it = records.erase(it);
			}
			else {
				++it;
			}
		}
	}
};

