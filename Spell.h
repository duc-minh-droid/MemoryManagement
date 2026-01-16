#pragma once
#include <string>
#include <iostream>

class Spell {
private:
    std::string name_;
    int mana_cost_;
public:
    Spell(std::string name, int mana_cost) : 
        name_(std::move(name)), mana_cost_(std::move(mana_cost))
    {
        
    }
    ~Spell() {

    }
    void cast() {
        std::cout << "Casting " << name_ << std::endl;
    }
};

