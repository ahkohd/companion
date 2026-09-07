cmake_minimum_required(VERSION 3.16)

set(COMPANION_BOARD "waveshare-1.75-b" CACHE STRING "Companion hardware profile")
if(NOT COMPANION_BOARD MATCHES "^[a-z0-9][a-z0-9.-]*$" OR
   NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/boards/${COMPANION_BOARD}/profile.cmake")
    message(FATAL_ERROR "Unknown Companion board profile: ${COMPANION_BOARD}")
endif()

set(ENV{COMPANION_BUILD_BOARD} "${COMPANION_BOARD}")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(herdr_status_face)
