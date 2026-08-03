package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

const (
	relayConcurrencyLeaseTTL       = 2 * time.Minute
	relayConcurrencyHeartbeatEvery = 30 * time.Second
	relayConcurrencyRedisTimeout   = 3 * time.Second
)

const acquireRelayConcurrencyScript = `
local current_time = redis.call('TIME')
local now = current_time[1] * 1000 + math.floor(current_time[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
return 1`

const renewRelayConcurrencyScript = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then
  return 0
end
local current_time = redis.call('TIME')
local now = current_time[1] * 1000 + math.floor(current_time[2] / 1000)
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1`

type relayConcurrencyLease struct {
	key        string
	member     string
	stop       chan struct{}
	done       chan struct{}
	stopOnce   sync.Once
	cancel     context.CancelFunc
	requestCtx context.Context
}

func RelayConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := common.GetContextKeyInt(c, constant.ContextKeyUserRelayConcurrency)
		if limit <= 0 {
			c.Next()
			return
		}

		if !common.RedisEnabled || common.RDB == nil {
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable,
				common.TranslateMessage(c, i18n.MsgRelayConcurrencyUnavailable),
				types.ErrorCodeRelayConcurrencyUnavailable)
			return
		}

		requestCtx, cancel := context.WithCancel(c.Request.Context())
		c.Request = c.Request.WithContext(requestCtx)
		lease, acquired, err := acquireRelayConcurrencyLease(
			requestCtx,
			c.GetInt("id"),
			limit,
			c.GetString(common.RequestIdKey),
			cancel,
		)
		if err != nil {
			cancel()
			logger.LogError(c.Request.Context(), "failed to acquire relay concurrency lease: "+err.Error())
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable,
				common.TranslateMessage(c, i18n.MsgRelayConcurrencyUnavailable),
				types.ErrorCodeRelayConcurrencyUnavailable)
			return
		}
		if !acquired {
			cancel()
			abortWithOpenAiMessage(c, http.StatusTooManyRequests,
				common.TranslateMessage(c, i18n.MsgRelayConcurrencyReached),
				types.ErrorCodeRelayConcurrencyReached)
			return
		}

		defer lease.Release()
		c.Next()
	}
}

func acquireRelayConcurrencyLease(ctx context.Context, userID int, limit int, member string, cancel context.CancelFunc) (*relayConcurrencyLease, bool, error) {
	if userID <= 0 || limit <= 0 {
		return nil, false, fmt.Errorf("invalid relay concurrency lease parameters")
	}
	if member == "" {
		member = common.NewRequestId()
	}
	key := fmt.Sprintf("relay:concurrency:user:%d", userID)
	operationCtx, operationCancel := context.WithTimeout(ctx, relayConcurrencyRedisTimeout)
	result, err := common.RDB.Eval(
		operationCtx,
		acquireRelayConcurrencyScript,
		[]string{key},
		limit,
		member,
		relayConcurrencyLeaseTTL.Milliseconds(),
	).Int()
	operationCancel()
	if err != nil {
		return nil, false, err
	}
	if result != 1 {
		return nil, false, nil
	}

	lease := &relayConcurrencyLease{
		key:        key,
		member:     member,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
		cancel:     cancel,
		requestCtx: ctx,
	}
	go lease.heartbeat()
	return lease, true, nil
}

func (lease *relayConcurrencyLease) heartbeat() {
	defer close(lease.done)
	ticker := time.NewTicker(relayConcurrencyHeartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-lease.stop:
			return
		case <-lease.requestCtx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), relayConcurrencyRedisTimeout)
			result, err := common.RDB.Eval(
				ctx,
				renewRelayConcurrencyScript,
				[]string{lease.key},
				lease.member,
				relayConcurrencyLeaseTTL.Milliseconds(),
			).Int()
			cancel()
			if err != nil || result != 1 {
				if err == nil {
					err = fmt.Errorf("relay concurrency lease ownership was lost")
				}
				logger.LogError(lease.requestCtx, err.Error())
				lease.cancel()
				return
			}
		}
	}
}

func (lease *relayConcurrencyLease) Release() {
	if lease == nil {
		return
	}
	lease.stopOnce.Do(func() {
		close(lease.stop)
		<-lease.done
		ctx, cancel := context.WithTimeout(context.Background(), relayConcurrencyRedisTimeout)
		defer cancel()
		if err := common.RDB.ZRem(ctx, lease.key, lease.member).Err(); err != nil {
			logger.LogError(context.Background(), "failed to release relay concurrency lease: "+err.Error())
		}
		lease.cancel()
	})
}
