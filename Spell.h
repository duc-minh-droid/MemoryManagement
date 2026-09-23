#pragma once
#include <string>
#include <iostream>
#include "Trace.h"

class Spell {
private:
    std::string name_;
    int mana_cost_;
public:
    Spell(std::string name, int mana_cost) :
        name_(std::move(name)), mana_cost_(mana_cost)
    {

    }
    ~Spell() {

    }
    void cast() {
        std::cout << "Casting " << name_ << std::endl;
    }

    const std::string& name() const { return name_; }
    int mana_cost() const { return mana_cost_; }
};

inline const char* trace_kind(trace::type_tag<Spell>) { return "Spell"; }
inline std::string trace_label(const Spell& s) { return s.name(); }
