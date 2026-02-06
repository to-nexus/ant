/**
 * MessageBroadcaster - Peripheral layer wrapper
 * 
 * Re-exports the core MessageBroadcaster for use in the ChatService layer.
 * The actual implementation and types live in core/chat/MessageBroadcaster.
 */

export { MessageBroadcaster, ChatBroadcastMessage } from '../../../../../core/chat/MessageBroadcaster';
