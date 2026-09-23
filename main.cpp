#include <cstring>
#include <fstream>
#include <iostream>
#include <streambuf>
#include <string>
#include "Spell.h"
#include "Arena.h"
#include "Monster.h"
#include "Pool.h"
#include "World.h"
#include "world_ptr.h"
#include "Trace.h"

// A 4-byte value allocated between spells, so the arena has to pad for alignment.
struct DamageRoll {
    int value;
};
inline const char* trace_kind(trace::type_tag<DamageRoll>) { return "DamageRoll"; }
inline std::string trace_label(const DamageRoll& d) { return std::to_string(d.value); }

// Section headers and narration. In --trace mode they become events the web
// visualizer shows as captions; otherwise sections print as headers.
static void section(const std::string& title, const std::string& text) {
    if (trace::on()) trace::emit("section", trace::Json().kv("title", title).kv("text", text));
    else std::cout << "\n== " << title << " ==\n";
}
static void note(const std::string& text) {
    trace::emit("note", trace::Json().kv("text", text));
}

// Turns everything printed to std::cout into "log" events while tracing.
class LineCapture : public std::streambuf {
private:
    std::string line_;
protected:
    int overflow(int ch) override {
        if (ch == traits_type::eof()) return 0;
        if (ch == '\n') {
            trace::emit("log", trace::Json().kv("text", line_));
            line_.clear();
        }
        else {
            line_ += static_cast<char>(ch);
        }
        return ch;
    }
};

static void arena_demo() {
    section("Arena", "A 256-byte bump allocator used as per-turn scratch memory for spells.");
    Arena dungeon(256, "spells");

    note("Turn 1: allocations are placed back to back; the bump pointer only moves forward.");
    Spell* fireball = dungeon.create<Spell>("Fire Ball", 10);
    fireball->cast();

    DamageRoll* roll = dungeon.create<DamageRoll>(DamageRoll{ 12 });
    std::cout << "Fire Ball rolls " << roll->value << " damage\n";

    note("Spell needs 8-byte alignment, so the arena pads 4 bytes after the 4-byte DamageRoll.");
    Spell* frost = dungeon.create<Spell>("Frost Bolt", 8);
    frost->cast();

    note("End of turn: reset() runs destructors in reverse order and rewinds the pointer to 0.");
    dungeon.reset();

    note("Turn 2: cast until the arena is full. create() returns nullptr instead of overflowing.");
    const char* names[] = { "Lightning", "Meteor", "Heal", "Haste", "Shield", "Blink", "Nova" };
    for (const char* name : names) {
        Spell* s = dungeon.create<Spell>(name, 5);
        if (!s) {
            std::cout << "Out of spell memory, " << name << " fizzles\n";
            break;
        }
        s->cast();
    }
    dungeon.reset();
}

static void pool_demo() {
    section("Pool", "Six fixed-size Monster slots. Freed slots go on a stack and are reused first.");
    Pool<Monster, 6> monsterPool("monsters");

    Monster* goblin = monsterPool.create("Goblin", 30);
    Monster* orc = monsterPool.create("Orc", 60);
    Monster* slime = monsterPool.create("Slime", 20);
    Monster* bat = monsterPool.create("Bat", 10);

    goblin->attack();
    orc->attack();

    note("The hero fights the Goblin. When it dies its slot is pushed onto the free stack.");
    goblin->hit(18);
    if (goblin->hit(15)) monsterPool.destroy(goblin);

    // Reuse memory
    note("A Troll spawns and gets the Goblin's old slot: last freed, first reused.");
    Monster* troll = monsterPool.create("Troll", 120);
    troll->attack();

    if (bat->hit(12)) monsterPool.destroy(bat);
    if (slime->hit(25)) monsterPool.destroy(slime);

    note("A Wolf spawns into the Slime's slot. The old slime pointer still points there...");
    Monster* wolf = monsterPool.create("Wolf", 40);
    wolf->attack();

    note("...so calling through the stale raw pointer silently talks to the Wolf. A pool cannot catch this.");
    trace::emit("raw_alias", trace::Json().kv("pool", "monsters").kv("name", "slime")
        .kv("slot", monsterPool.slot_of(slime)).kv("expected", "Slime").kv("actual", slime->name()));
    slime->attack();

    note("Destroying the Bat twice would corrupt the free list. The pool checks its live flags and refuses.");
    monsterPool.destroy(bat);

    note("Fill the remaining slots. The seventh monster has nowhere to go.");
    monsterPool.create("Imp", 15);
    monsterPool.create("Ghoul", 45);
    monsterPool.create("Wraith", 50);
    if (!monsterPool.create("Hydra", 300)) {
        std::cout << "Pool full, the Hydra cannot spawn\n";
    }
    note("Pool goes out of scope: every live slot is destroyed.");
}

static void world_demo() {
    section("World", "Arena-backed objects behind reference-counted, generation-checked world_ptr handles.");
    World world;

    world_ptr<Monster> minotaur = world.spawn<Monster>("Minotaur", 80);
    minotaur->attack();

    {
        note("Copying a handle bumps the record's refcount; the copy dies at the end of the scope.");
        world_ptr<Monster> bigger_minotaur = minotaur;
        bigger_minotaur->attack();
    }

    world_ptr<Monster> dragon = world.spawn<Monster>("Dragon", 200);

    {
        world_ptr<Monster> skeleton = world.spawn<Monster>("Skeleton", 25);
        skeleton->attack();
    }
    note("The Skeleton has no handles left, but it stays alive until collect() runs.");

    world.collect();
    note("collect() destroyed it and bumped its slot generation. Its arena bytes stay as a hole until reset.");

    world_ptr<Monster> lich = world.spawn<Monster>("Lich", 90);
    note("The Lich reuses the Skeleton's record slot (generation 2) but takes fresh arena bytes at the top.");

    note("Keep a second handle to the Dragon, then kill it outright while that handle still exists.");
    world_ptr<Monster> remembered = dragon;
    dragon->hit(120);
    if (dragon->hit(90)) world.kill(dragon);

    note("The old handle remembers generation 1, the slot is now at 2: dereferencing it is caught.");
    try {
        remembered->attack();
    }
    catch (const dangling_world_ptr& e) {
        std::cout << "Caught: " << e.what() << "\n";
    }

    world_ptr<Monster> wyvern = world.spawn<Monster>("Wyvern", 70);
    note("A Wyvern moves into the Dragon's old slot. The stale handle is still rejected: generations differ.");
    if (Monster* m = remembered.get()) {
        m->attack();
    }
    else {
        std::cout << "remembered dragon handle is stale, Wyvern is safe\n";
    }
    wyvern->attack();
    lich->attack();
    note("End of scope: handles drop, then the World resets its arena and destroys what is left.");
}

static void usage() {
    std::cout << "usage: MemManBook [--trace <file.json|file.js|->]\n"
                 "  --trace  run the demo and write allocator events as JSON\n"
                 "           (a .js file assigns window.MEMMAN_TRACE for the web viewer)\n";
}

int main(int argc, char** argv)
{
    const char* tracePath = nullptr;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--trace") == 0 && i + 1 < argc) {
            tracePath = argv[++i];
        }
        else {
            usage();
            return std::strcmp(argv[i], "--help") == 0 ? 0 : 1;
        }
    }

    LineCapture capture;
    std::streambuf* original = nullptr;
    if (tracePath) {
        trace::Tracer::get().enable();
        original = std::cout.rdbuf(&capture);
    }

    arena_demo();
    pool_demo();
    world_demo();

    if (tracePath) {
        std::cout.rdbuf(original);
        std::string path = tracePath;
        bool asJs = path.size() > 3 && path.compare(path.size() - 3, 3, ".js") == 0;
        if (path == "-") {
            trace::Tracer::get().write(std::cout, false);
        }
        else {
            std::ofstream out(path);
            if (!out) {
                std::cerr << "cannot write " << path << "\n";
                return 1;
            }
            trace::Tracer::get().write(out, asJs);
            std::cerr << "trace written to " << path << "\n";
        }
    }
    return 0;
}
