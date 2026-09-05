#include <stdio.h>
#include "display_module.h"

int main(void)
{
    char line[4096];
    while (fgets(line, sizeof(line), stdin)) {
        cJSON *root = cJSON_Parse(line);
        module_snapshot_t module;
        if (!cJSON_IsObject(root) || !display_module_parse(root, &module)) puts("null");
        else {
            module_design_t design;
            display_module_design(&module, &design);
            printf("{\"module\":\"%s\",\"values\":[", display_module_name(module.kind));
            unsigned length = module_design_length(module.kind);
            for (unsigned i = 0; i < length; ++i) printf("%s%ld", i ? "," : "", (long)design.values[i]);
            puts("]}");
        }
        cJSON_Delete(root);
    }
}
