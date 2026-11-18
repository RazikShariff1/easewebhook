// Package ids generates prefixed, URL-safe identifiers (src_..., evt_..., etc.).
package ids

import (
	"crypto/rand"
	"math/big"
)

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

const (
	Source         = "src"
	Destination    = "des"
	Connection     = "web"
	Transformation = "trs"
	Request        = "req"
	Event          = "evt"
	Attempt        = "atm"
)

// Random returns n random base62 characters.
func Random(n int) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))

	for i := range b {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}

		b[i] = alphabet[v.Int64()]
	}

	return string(b)
}

// New returns "<prefix>_<14 random chars>".
func New(prefix string) string {
	return prefix + "_" + Random(14)
}

// SourceKey returns a lowercase key used in the public ingestion URL.
func SourceKey() string {
	b := []byte(Random(16))
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}

	return string(b)
}
