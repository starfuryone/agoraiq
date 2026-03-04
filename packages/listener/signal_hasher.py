import hashlib

def compute_signal_hash(message_text, channel_id, message_id, message_timestamp):
    raw = f"{channel_id}|{message_id}|{message_timestamp}|{message_text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
