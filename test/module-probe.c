#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "display_module.h"

int main(void)
{
    char line[4096];
    while (fgets(line, sizeof(line), stdin) != NULL) {
        cJSON *root = cJSON_Parse(line);
        module_snapshot_t snapshot;
        bool accepted = cJSON_IsObject(root) && display_module_parse(root, &snapshot);
        if (!accepted) puts("null");
        else printf("{\"kind\":%d,\"index\":%u,\"modules\":%u,\"navigation\":%s,\"cardBackgrounds\":%s,\"status\":%d,\"pageIndex\":%u,\"pageCount\":%u,\"providerBytes\":%zu,\"refreshing\":%s,\"primary\":%s,\"remaining\":%.2f,\"hasCount\":%s,\"count\":%u,\"countMore\":%s,\"boxes\":%u,\"boxAvailable\":[%s,%s,%s],\"messages\":%u,\"messageBytes\":[[%zu,%zu],[%zu,%zu],[%zu,%zu]],\"time\":\"%s\",\"weekday\":\"%s\",\"blinkSeparator\":%s,\"expanded\":%s,\"openToken\":\"%s\",\"openable\":[%s,%s],\"messageOpenable\":[%s,%s,%s]}\n",
            snapshot.kind, snapshot.index, snapshot.count, snapshot.show_navigation ? "true" : "false", snapshot.show_card_backgrounds ? "true" : "false", snapshot.status,
            snapshot.page_index, snapshot.page_count, strlen(snapshot.primary.provider),
            snapshot.refreshing ? "true" : "false",
            snapshot.primary.available ? "true" : "false", (double)snapshot.primary.remaining,
            snapshot.has_count ? "true" : "false", snapshot.total, snapshot.count_more ? "true" : "false", snapshot.box_count,
            snapshot.boxes[0].available ? "true" : "false", snapshot.boxes[1].available ? "true" : "false", snapshot.boxes[2].available ? "true" : "false",
            snapshot.message_count,
            strlen(snapshot.messages[0].sender), strlen(snapshot.messages[0].subject),
            strlen(snapshot.messages[1].sender), strlen(snapshot.messages[1].subject),
            strlen(snapshot.messages[2].sender), strlen(snapshot.messages[2].subject),
            snapshot.time, snapshot.weekday, snapshot.blink_separator ? "true" : "false", snapshot.expanded ? "true" : "false", snapshot.open_token,
            snapshot.primary.openable ? "true" : "false", snapshot.secondary.openable ? "true" : "false",
            snapshot.messages[0].openable ? "true" : "false", snapshot.messages[1].openable ? "true" : "false", snapshot.messages[2].openable ? "true" : "false");
        cJSON_Delete(root);
    }
    return 0;
}
