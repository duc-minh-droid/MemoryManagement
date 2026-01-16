# Memory Management Library

A C++ memory management library demonstrating custom allocators and smart pointer implementations for game development and high-performance applications.

## Overview

This project implements three custom memory management strategies:

1. **Arena Allocator** - Fast sequential allocation with bulk deallocation
2. **Object Pool** - Fixed-size memory pool for efficient object reuse
3. **World Manager** - Reference-counted smart pointer system with garbage collection

## Features

### Arena Allocator

The `Arena` class provides fast linear allocation from a pre-allocated memory buffer.

- Sequential memory allocation with proper alignment
- Automatic destructor registration and invocation
- Bulk reset for fast cleanup
- Zero fragmentation

**Use case**: Temporary allocations, level loading, frame-based allocations

### Object Pool

The `Pool` template class manages a fixed-size pool of objects with O(1) allocation and deallocation.

- Fixed capacity known at compile time
- Memory reuse without fragmentation
- Fast allocation from free list
- Ideal for objects with frequent creation/destruction

**Use case**: Bullets, particles, enemies, temporary game objects

### World Manager with Smart Pointers

The `World` class combined with `world_ptr` implements a reference-counted memory management system.

- Automatic reference counting
- Garbage collection on demand
- Arena-backed allocation
- Safe shared ownership

**Use case**: Scene graphs, entity management, resource sharing

## Project Structure

```
MemManBook/
??? Arena.h/cpp           - Arena allocator implementation
??? Pool.h/cpp            - Object pool template
??? World.h/cpp           - World manager with garbage collection
??? world_ptr.h/cpp       - Smart pointer for World-managed objects
??? Monster.h/cpp         - Example game object
??? Spell.h/cpp           - Example game object
??? main.cpp              - Usage examples and tests
```

## Usage Examples

### Arena Allocator

```cpp
Arena dungeon(1024);
Spell* fireball = dungeon.create<Spell>("Fire Ball", 10);
fireball->cast();

// Destroy all objects and reset arena
dungeon.reset();
```

### Object Pool

```cpp
Pool<Monster, 2> monsterPool;

Monster* goblin = monsterPool.create("Goblin", 30);
Monster* orc = monsterPool.create("Orc", 60);

goblin->attack();
orc->attack();

monsterPool.destroy(goblin);

// Reuse the memory slot
Monster* troll = monsterPool.create("Troll", 120);
troll->attack();
```

### World Manager

```cpp
World world;

{
    world_ptr<Monster> minotaur = world.spawn<Monster>("Minotaur", 30);
    minotaur->attack();
    
    world_ptr<Monster> reference = minotaur;  // Increase ref count
}  // Ref count drops to 0

// Collect objects with zero references
world.collect();
```

## Building

### Requirements

- C++11 or later
- Visual Studio 2017 or later (for .vcxproj)
- Or any C++11 compliant compiler

### Visual Studio

Open `MemManBook.slnx` or `MemManBook.vcxproj` and build the project.

### Command Line

```bash
cl /EHsc /std:c++11 main.cpp Arena.cpp Monster.cpp Pool.cpp Spell.cpp World.cpp world_ptr.cpp
```

Or with g++:

```bash
g++ -std=c++11 main.cpp Arena.cpp Monster.cpp Pool.cpp Spell.cpp World.cpp world_ptr.cpp -o MemManBook
```

## Output

When running the program, you should see:

```
Casting Fire Ball
Monster spawned: Goblin
Monster spawned: Orc
Goblin attacks!
Orc attacks!
Monster destroyed: Goblin
Monster spawned: Troll
Troll attacks!
Monster destroyed: Troll
Monster spawned: Minotaur
Minotaur attacks!
Monster destroyed: Minotaur
```

## Key Implementation Details

### Memory Alignment

The Arena allocator properly aligns memory allocations based on type requirements:

```cpp
while (reinterpret_cast<std::size_t>(offset_) % alignof(T) != 0) {
    ++offset_;
}
```

### Destructor Management

Both Arena and World track destructors using type-erased function pointers:

```cpp
[](void* p) { static_cast<T*>(p)->~T(); }
```

### Reference Counting

The `world_ptr` manages reference counts automatically through copy constructor and destructor:

```cpp
world_ptr(const world_ptr& other) : record_(other.record_) {
    if (record_) {
        record_->refCount++;
    }
}
```

## Performance Characteristics

| Allocator | Allocation | Deallocation | Fragmentation |
|-----------|-----------|--------------|---------------|
| Arena     | O(1)      | O(n) bulk    | None          |
| Pool      | O(1)      | O(1)         | None          |
| World     | O(1)      | O(n) scan    | None          |

## License

This project is provided as-is for educational purposes.

## Contributing

This is an educational project demonstrating custom memory management techniques in C++.
