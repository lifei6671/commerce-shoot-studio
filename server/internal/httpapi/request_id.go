package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"sync/atomic"
)

const requestIDProcessKeyBytes = 32

type requestIDIssuer struct {
	processKey [requestIDProcessKeyBytes]byte
	sequence   atomic.Uint64
}

func newRequestIDIssuer(entropy io.Reader) (*requestIDIssuer, error) {
	if entropy == nil {
		return nil, fmt.Errorf("Request ID 进程密钥不可用")
	}
	issuer := &requestIDIssuer{}
	if _, err := io.ReadFull(entropy, issuer.processKey[:]); err != nil {
		return nil, fmt.Errorf("Request ID 进程密钥不可用")
	}
	return issuer, nil
}

func (issuer *requestIDIssuer) Next() string {
	var message [8]byte
	binary.BigEndian.PutUint64(message[:], issuer.sequence.Add(1))
	mac := hmac.New(sha256.New, issuer.processKey[:])
	_, _ = mac.Write(message[:])
	digest := mac.Sum(nil)
	return hex.EncodeToString(digest[:16])
}
