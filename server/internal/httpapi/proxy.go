package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/netip"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/lifei6671/commerce-shoot-studio/server/lib/apperror"
	"github.com/lifei6671/commerce-shoot-studio/server/lib/response"
)

type requestMetadataContextKey struct{}

type requestMetadata struct {
	clientIP       netip.Addr
	externalOrigin originInfo
	trustedProxy   bool
}

func cloneTrustedProxyCIDRs(source []netip.Prefix) ([]netip.Prefix, []string, error) {
	if len(source) == 0 {
		return nil, nil, nil
	}
	cloned := make([]netip.Prefix, 0, len(source))
	canonical := make([]string, 0, len(source))
	seen := make(map[string]struct{}, len(source))
	for _, prefix := range source {
		if !prefix.IsValid() || prefix.Addr().Is4In6() || prefix != prefix.Masked() || prefix.Bits() == 0 {
			return nil, nil, fmt.Errorf("trusted proxy CIDR 非法")
		}
		text := prefix.String()
		if _, duplicate := seen[text]; duplicate {
			return nil, nil, fmt.Errorf("trusted proxy CIDR 重复")
		}
		seen[text] = struct{}{}
		cloned = append(cloned, prefix)
		canonical = append(canonical, text)
	}
	return cloned, canonical, nil
}

func (runtime *runtime) proxyMiddleware() gin.HandlerFunc {
	return func(ginContext *gin.Context) {
		request := ginContext.Request
		if request == nil {
			runtime.rejectProxyMetadata(ginContext)
			return
		}
		defer removeForwardedHeaders(request.Header)

		peerIP, ok := parseTransportPeer(request.RemoteAddr)
		if !ok {
			runtime.rejectProxyMetadata(ginContext)
			return
		}
		trustedPeer := runtime.isTrustedProxy(peerIP)
		metadata := requestMetadata{clientIP: peerIP}
		if trustedPeer && identifyAPISurface(request.URL.Path) != surfaceNone {
			clientIP, externalOrigin, valid := parseForwardedTuple(request.Header)
			if !valid {
				runtime.rejectProxyMetadata(ginContext)
				return
			}
			metadata.clientIP = clientIP
			metadata.externalOrigin = externalOrigin
			metadata.trustedProxy = true
		} else {
			externalOrigin, valid := parseDirectExternalOrigin(request)
			if !valid {
				if identifyAPISurface(request.URL.Path) != surfaceNone {
					runtime.rejectProxyMetadata(ginContext)
					return
				}
			} else {
				metadata.externalOrigin = externalOrigin
			}
		}

		removeForwardedHeaders(request.Header)
		ginContext.Request = request.WithContext(context.WithValue(request.Context(), requestMetadataContextKey{}, metadata))
		ginContext.Next()
	}
}

func (runtime *runtime) rejectProxyMetadata(ginContext *gin.Context) {
	response.WriteError(ginContext, apperror.ErrForbidden)
	ginContext.Abort()
}

func (runtime *runtime) isTrustedProxy(peer netip.Addr) bool {
	for _, prefix := range runtime.trustedProxyCIDRs {
		if prefix.Contains(peer) {
			return true
		}
	}
	return false
}

func requestMetadataFromRequest(request *http.Request) (requestMetadata, bool) {
	if request == nil {
		return requestMetadata{}, false
	}
	metadata, ok := request.Context().Value(requestMetadataContextKey{}).(requestMetadata)
	return metadata, ok
}

func parseTransportPeer(remoteAddr string) (netip.Addr, bool) {
	addressPort, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return netip.Addr{}, false
	}
	address := addressPort.Addr()
	if address.Zone() != "" {
		return netip.Addr{}, false
	}
	return address.Unmap(), true
}

func parseForwardedTuple(header http.Header) (netip.Addr, originInfo, bool) {
	rawClientIP, ok := singleProxyHeaderValue(header, "X-Forwarded-For")
	if !ok {
		return netip.Addr{}, originInfo{}, false
	}
	clientIP, err := netip.ParseAddr(rawClientIP)
	if err != nil || clientIP.Zone() != "" {
		return netip.Addr{}, originInfo{}, false
	}
	clientIP = clientIP.Unmap()

	scheme, ok := singleProxyHeaderValue(header, "X-Forwarded-Proto")
	if !ok || scheme != "http" && scheme != "https" {
		return netip.Addr{}, originInfo{}, false
	}
	authority, ok := singleProxyHeaderValue(header, "X-Forwarded-Host")
	if !ok {
		return netip.Addr{}, originInfo{}, false
	}
	externalOrigin, ok := parseOrigin(scheme+"://"+authority, true)
	if !ok || authority != strings.TrimPrefix(externalOrigin.normalized, scheme+"://") {
		return netip.Addr{}, originInfo{}, false
	}
	return clientIP, externalOrigin, true
}

func singleProxyHeaderValue(header http.Header, name string) (string, bool) {
	var values []string
	for key, current := range header {
		if strings.EqualFold(key, name) {
			values = append(values, current...)
		}
	}
	if len(values) != 1 {
		return "", false
	}
	value := values[0]
	if value == "" || value != strings.TrimSpace(value) || strings.Contains(value, ",") || strings.ContainsAny(value, "\r\n") {
		return "", false
	}
	return value, true
}

func parseDirectExternalOrigin(request *http.Request) (originInfo, bool) {
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	}
	return parseOrigin(scheme+"://"+request.Host, true)
}

func removeForwardedHeaders(header http.Header) {
	for name := range header {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-forwarded-") || lower == "forwarded" || lower == "x-real-ip" {
			delete(header, name)
		}
	}
}
