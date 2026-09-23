cmake_minimum_required(VERSION 3.16)
project(MemManBook CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(MemManBook
    main.cpp Arena.cpp Monster.cpp Pool.cpp Spell.cpp World.cpp world_ptr.cpp)

if(MSVC)
    target_compile_options(MemManBook PRIVATE /W4 /EHsc)
else()
    target_compile_options(MemManBook PRIVATE -Wall -Wextra -pedantic)
endif()

# cmake --build build --target trace  ->  regenerates the web viewer's data
add_custom_target(trace
    COMMAND MemManBook --trace ${CMAKE_SOURCE_DIR}/web/trace.json
    COMMAND MemManBook --trace ${CMAKE_SOURCE_DIR}/web/trace.js
    DEPENDS MemManBook
    COMMENT "Writing web/trace.json and web/trace.js")
