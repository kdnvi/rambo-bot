package flavor

import (
	"context"
	"log/slog"
	"math/rand/v2"
)

// Reader can fetch flavor lines from a backing store.
type Reader interface {
	ReadFlavor(ctx context.Context) (map[string][]string, error)
}

// PickLine returns a random line for the given flavor key.
// Returns empty string if the key doesn't exist or the store is unavailable.
func PickLine(ctx context.Context, r Reader, key string) string {
	all, err := r.ReadFlavor(ctx)
	if err != nil {
		slog.Error("failed to read flavor", "key", key, "err", err)
		return ""
	}
	lines := all[key]
	if len(lines) == 0 {
		return ""
	}
	return lines[rand.IntN(len(lines))]
}
