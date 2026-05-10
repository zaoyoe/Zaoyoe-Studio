/**
 * Notification Manager - Centralized notification system with automatic Realtime → Polling fallback
 * 
 * Features:
 * - Automatic detection of Realtime (WebSocket) connection status
 * - Seamless fallback to polling when Realtime fails
 * - Periodic attempts to recover Realtime connection
 * - Unified API for all notification channels
 * 
 * Usage:
 * NotificationManager.subscribe({
 *   channel: 'my-channel',
 *   table: 'my_table',
 *   event: 'INSERT',
 *   onMessage: (payload) => { console.log('New record:', payload.new); }
 * });
 */

class NotificationManager {
    constructor() {
        this.channels = new Map(); // Store channel configs
        this.realtimeChannels = new Map(); // Store Realtime channel instances
        this.pollingIntervals = new Map(); // Store polling interval IDs
        this.realtimeSubscribeTimers = new Map(); // Store Realtime subscribe timeout IDs
        this.lastRecordIds = new Map(); // Track last seen record ID per channel
        this.realtimeRetryInterval = null;
        this.mode = 'realtime'; // 'realtime' or 'polling'
        this.isReady = false;
        this.pendingSubscriptions = []; // Queue subscriptions until client is ready

        // Initialize client reference
        this.initializeClient();
    }

    /**
     * Initialize or wait for Supabase client
     */
    initializeClient() {
        this.supabaseClient = window.supabaseClient || window.supabase;

        if (this.supabaseClient) {
            console.log('✅ [NotificationManager] Supabase client ready');
            this.isReady = true;
            this.processPendingSubscriptions();
        } else {
            console.warn('⏳ [NotificationManager] Waiting for Supabase client...');
            // Retry every 500ms for up to 30 seconds
            let attempts = 0;
            const maxAttempts = 60;

            const checkInterval = setInterval(() => {
                attempts++;
                this.supabaseClient = window.supabaseClient || window.supabase;

                if (this.supabaseClient) {
                    console.log('✅ [NotificationManager] Supabase client ready (after waiting)');
                    this.isReady = true;
                    clearInterval(checkInterval);
                    this.processPendingSubscriptions();
                } else if (attempts >= maxAttempts) {
                    console.error('❌ [NotificationManager] Supabase client timeout after 30s');
                    clearInterval(checkInterval);
                    // Still mark as ready to allow polling mode
                    this.isReady = true;
                    this.processPendingSubscriptions();
                }
            }, 500);
        }
    }

    /**
     * Process subscriptions that were queued before client was ready
     */
    processPendingSubscriptions() {
        if (this.pendingSubscriptions.length > 0) {
            console.log(`🔄 [NotificationManager] Processing ${this.pendingSubscriptions.length} pending subscriptions`);

            this.pendingSubscriptions.forEach(config => {
                this.subscribe(config);
            });

            this.pendingSubscriptions = [];
        }
    }

    /**
     * Subscribe to a notification channel
     * @param {Object} config - Channel configuration
     * @param {string} config.channel - Unique channel name
     * @param {string} config.table - Database table to watch
     * @param {string} config.event - Event type ('INSERT', 'UPDATE', 'DELETE', or '*')
     * @param {Function} config.onMessage - Callback when message received (payload) => void
     * @param {Function} [config.pollingQuery] - Optional custom polling query
     * @param {number} [config.pollingInterval] - Polling interval in ms (default: 3000)
     */
    subscribe(config) {
        const {
            channel,
            table,
            event = 'INSERT',
            onMessage,
            pollingQuery = null,
            pollingInterval = 3000
        } = config;

        if (!channel || !table || !onMessage) {
            console.error('❌ [NotificationManager] Missing required config:', config);
            return;
        }

        // If client not ready, queue the subscription
        if (!this.isReady) {
            console.log(`⏳ [${channel}] Queueing subscription until client ready`);
            this.pendingSubscriptions.push(config);
            return;
        }

        // Store config for fallback and recovery
        this.channels.set(channel, {
            ...config,
            pollingInterval
        });

        // Initialize last seen timestamp (ISO format for universal compatibility)
        this.lastRecordIds.set(channel, new Date(0).toISOString());

        // Try Realtime first
        this.setupRealtime(config);

        console.log(`📡 [${channel}] Subscribed to notifications`);
    }

    /**
     * Setup Realtime (WebSocket) subscription
     */
    setupRealtime(config) {
        const { channel, table, event, onMessage, filter } = config;
        const realtimeTimeoutMs = Math.max(1000, Number(config.realtimeTimeoutMs || 2600) || 2600);

        if (!this.supabaseClient) {
            console.warn(`⚠️ [${channel}] No Supabase client, falling back to polling`);
            this.startPolling(config);
            return;
        }

        this.clearRealtimeSubscribeTimer(channel);

        const markRealtimeDegraded = (reason = 'channel_error') => {
            this.clearRealtimeSubscribeTimer(channel);
            const currentChannel = this.realtimeChannels.get(channel);
            if (currentChannel) {
                try {
                    this.supabaseClient?.removeChannel?.(currentChannel);
                } catch (error) {
                    console.warn(`⚠️ [${channel}] Failed to remove degraded Realtime channel:`, error?.message || error);
                }
                this.realtimeChannels.delete(channel);
            }
            console.warn(`⚠️ [${channel}] Realtime degraded (${reason}), falling back to polling`);
            this.startPolling(config);
            this.mode = 'polling';
            try {
                window.dispatchEvent(new CustomEvent('zaoyoe:realtime-state', {
                    detail: {
                        feature: 'notification-manager',
                        channel,
                        status: 'degraded',
                        reason
                    }
                }));
            } catch (_) {
                // diagnostic event only
            }
        };

        // Create Realtime channel
        const realtimeChannel = this.supabaseClient
            .channel(channel)
            .on(
                'postgres_changes',
                {
                    event: event,
                    schema: 'public',
                    table: table,
                    ...(filter || {})
                },
                (payload) => {
                    // Update last seen ID
                    if (payload.new && payload.new.id) {
                        this.lastRecordIds.set(channel, payload.new.id);
                    }
                    onMessage(payload);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    this.clearRealtimeSubscribeTimer(channel);
                    console.log(`✅ [${channel}] Realtime connected`);
                    this.stopPolling(channel);
                    this.mode = 'realtime';
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    markRealtimeDegraded(status.toLowerCase());
                } else if (status === 'CLOSED') {
                    markRealtimeDegraded('closed');
                }
            });

        // Store channel instance
        this.realtimeChannels.set(channel, realtimeChannel);
        const timerId = setTimeout(() => {
            markRealtimeDegraded('subscribe_timeout');
        }, realtimeTimeoutMs);
        this.realtimeSubscribeTimers.set(channel, timerId);
    }

    /**
     * Start polling for updates
     */
    startPolling(config) {
        const { channel, table, event, onMessage, pollingQuery, pollingInterval = 3000 } = config;

        // Don't start if already polling
        if (this.pollingIntervals.has(channel)) {
            return;
        }

        const poll = async () => {
            try {
                // Safety check: ensure client is available
                if (!this.supabaseClient) {
                    console.warn(`⚠️ [${channel}] Polling skipped - Supabase client not available`);
                    return;
                }

                let data, error;

                // Use custom query if provided
                if (pollingQuery) {
                    const result = await pollingQuery(this.lastRecordIds.get(channel));
                    data = result.data;
                    error = result.error;
                } else {
                    // Default polling query (timestamp-based for UUID compatibility)
                    const lastTimestamp = this.lastRecordIds.get(channel) || new Date(0).toISOString();
                    const query = this.supabaseClient
                        .from(table)
                        .select('id, created_at')
                        .gt('created_at', lastTimestamp)
                        .order('created_at', { ascending: true });

                    const result = await query;
                    data = result.data;
                    error = result.error;
                }

                if (error) {
                    console.error(`❌ [${channel}] Polling error:`, error);
                    return;
                }

                if (data && data.length > 0) {
                    data.forEach(record => {
                        // Simulate Realtime payload format
                        const payload = {
                            new: record,
                            old: null,
                            eventType: event
                        };
                        onMessage(payload);

                        // Update last seen timestamp
                        if (record.created_at) {
                            this.lastRecordIds.set(channel, record.created_at);
                        }
                    });
                }
            } catch (err) {
                console.error(`❌ [${channel}] Polling exception:`, err);
            }
        };

        // Start polling
        const intervalId = setInterval(poll, pollingInterval);
        this.pollingIntervals.set(channel, intervalId);

        console.log(`🔄 [${channel}] Polling started (${pollingInterval / 1000}s interval)`);

        // Run first poll immediately
        poll();
    }

    /**
     * Stop polling for a channel
     */
    stopPolling(channel) {
        const intervalId = this.pollingIntervals.get(channel);
        if (intervalId) {
            clearInterval(intervalId);
            this.pollingIntervals.delete(channel);
            console.log(`⏸️ [${channel}] Polling stopped`);
        }
    }

    clearRealtimeSubscribeTimer(channel) {
        const timerId = this.realtimeSubscribeTimers.get(channel);
        if (timerId) {
            clearTimeout(timerId);
            this.realtimeSubscribeTimers.delete(channel);
        }
    }

    /**
     * Unsubscribe from a channel
     */
    unsubscribe(channel) {
        // Unsubscribe from Realtime
        const realtimeChannel = this.realtimeChannels.get(channel);
        if (realtimeChannel) {
            this.clearRealtimeSubscribeTimer(channel);
            this.supabaseClient.removeChannel(realtimeChannel);
            this.realtimeChannels.delete(channel);
        }

        // Stop polling
        this.stopPolling(channel);

        // Remove config
        this.channels.delete(channel);
        this.lastRecordIds.delete(channel);

        console.log(`🔌 [${channel}] Unsubscribed`);
    }

    /**
     * Enable automatic Realtime recovery
     * Periodically attempts to reconnect to Realtime if in polling mode
     */
    enableRealtimeRecovery(intervalMs = 60000) {
        if (this.realtimeRetryInterval) {
            return; // Already enabled
        }

        this.realtimeRetryInterval = setInterval(() => {
            if (this.mode === 'polling') {
                console.log('🔄 Attempting to recover Realtime connections...');

                this.channels.forEach((config, channel) => {
                    // Unsubscribe from old Realtime channel if exists
                    const oldChannel = this.realtimeChannels.get(channel);
                    if (oldChannel) {
                        this.clearRealtimeSubscribeTimer(channel);
                        this.supabaseClient.removeChannel(oldChannel);
                    }

                    // Try to reconnect
                    this.setupRealtime(config);
                });
            }
        }, intervalMs);

        console.log(`🔄 Realtime recovery enabled (every ${intervalMs / 1000}s)`);
    }

    /**
     * Disable automatic Realtime recovery
     */
    disableRealtimeRecovery() {
        if (this.realtimeRetryInterval) {
            clearInterval(this.realtimeRetryInterval);
            this.realtimeRetryInterval = null;
            console.log('⏸️ Realtime recovery disabled');
        }
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get status of all channels
     */
    getStatus() {
        const status = {
            mode: this.mode,
            channels: []
        };

        this.channels.forEach((config, channel) => {
            const isPolling = this.pollingIntervals.has(channel);
            const hasRealtime = this.realtimeChannels.has(channel);

            status.channels.push({
                name: channel,
                table: config.table,
                mode: isPolling ? 'polling' : (hasRealtime ? 'realtime' : 'unknown'),
                lastRecordId: this.lastRecordIds.get(channel)
            });
        });

        return status;
    }
}

// Create and export singleton instance
if (!window.NotificationManager) {
    window.NotificationManager = new NotificationManager();
    console.log('✅ NotificationManager initialized');
}

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.NotificationManager;
}
