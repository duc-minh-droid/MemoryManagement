#pragma once
#include <string>
#include <iostream>
#include "Trace.h"

class Monster {
private:
    std::string name_;
    int hp_;

public:
    Monster(std::string name, int hp)
        : name_(std::move(name)), hp_(hp)
    {
        std::cout << "Monster spawned: " << name_ << "\n";
        trace::emit("monster_new", trace::Json().kv("label", name_).kv("hp", hp_));
    }

    ~Monster() {
        std::cout << "Monster destroyed: " << name_ << "\n";
        trace::emit("monster_destroyed", trace::Json().kv("label", name_));
    }

    void attack() {
        std::cout << name_ << " attacks!\n";
    }

    // returns true when the monster has no hp left
    bool hit(int damage) {
        hp_ -= damage;
        if (hp_ < 0) hp_ = 0;
        std::cout << name_ << " takes " << damage << " damage (" << hp_ << " hp left)\n";
        trace::emit("monster_hit", trace::Json().kv("label", name_).kv("damage", damage).kv("hp", hp_));
        return hp_ == 0;
    }

    const std::string& name() const { return name_; }
    int hp() const { return hp_; }
};

inline const char* trace_kind(trace::type_tag<Monster>) { return "Monster"; }
inline std::string trace_label(const Monster& m) { return m.name(); }
