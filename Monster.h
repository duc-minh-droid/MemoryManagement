#pragma once
#include <string>
#include <iostream>

class Monster {
private:
    std::string name_;
    int hp_;

public:
    Monster(std::string name, int hp)
        : name_(std::move(name)), hp_(hp)
    {
        std::cout << "Monster spawned: " << name_ << "\n";
    }

    ~Monster() {
        std::cout << "Monster destroyed: " << name_ << "\n";
    }

    void attack() {
        std::cout << name_ << " attacks!\n";
    }
};
