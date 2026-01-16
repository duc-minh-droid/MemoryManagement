#include <iostream>
#include "Spell.h"
#include "Arena.h"
#include "Monster.h"
#include "Pool.h"
#include "World.h"
#include "world_ptr.h"

int main()
{
    Arena dungeon(1024);
    Spell* fireball = dungeon.create<Spell>("Fire Ball", 10);

    fireball->cast();

    dungeon.reset();

    Pool<Monster, 2> monsterPool;

    Monster* goblin = monsterPool.create("Goblin", 30);
    Monster* orc = monsterPool.create("Orc", 60);

    goblin->attack();
    orc->attack();

    monsterPool.destroy(goblin);

    // Reuse memory
    Monster* troll = monsterPool.create("Troll", 120);
    troll->attack();

    monsterPool.destroy(troll);

    World world;

    {
        world_ptr<Monster> minatour = world.spawn<Monster>("Minatour", 30);
        minatour->attack();

        world_ptr<Monster> bigger_minatour = minatour;
    }

    // confirm world stil has minatour

    // world reset
    world.collect();

    return 0;
}
