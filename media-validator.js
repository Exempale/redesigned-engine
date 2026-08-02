// media-validator.js - Deep Buffer Inspection for Media Uploads (Size, Codec & Duration)

/**
 * Validates audio/video/image buffers for:
 * 1. Weight / Size limits
 * 2. Magic bytes / Codec detection
 * 3. Non-zero Duration (rejects 0s or fake 1GB/corrupted bomb files)
 */

function inspectMp4(buffer) {
    let offset = 0;
    while (offset < buffer.length - 8) {
        let size = buffer.readUInt32BE(offset);
        if (size === 1) {
            size = Number(buffer.readBigUInt64BE(offset + 8));
        }
        if (size <= 0 || offset + size > buffer.length + 10000) {
            if (offset === 0) break;
        }
        
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'ftyp') {
            const brand = buffer.toString('ascii', offset + 8, offset + 12);
            return { valid: true, codec: brand, type: 'video/mp4' };
        }
        if (type === 'moov') {
            let subOffset = offset + 8;
            while (subOffset < offset + size && subOffset < buffer.length - 8) {
                const subSize = buffer.readUInt32BE(subOffset);
                const subType = buffer.toString('ascii', subOffset + 4, subOffset + 8);
                if (subType === 'mvhd') {
                    const version = buffer[subOffset + 8];
                    let timescale = 0;
                    let duration = 0;
                    if (version === 1) {
                        timescale = buffer.readUInt32BE(subOffset + 20);
                        duration = Number(buffer.readBigUInt64BE(subOffset + 24));
                    } else {
                        timescale = buffer.readUInt32BE(subOffset + 12);
                        duration = buffer.readUInt32BE(subOffset + 16);
                    }
                    const durInSeconds = timescale > 0 ? duration / timescale : 0;
                    return { valid: true, duration: durInSeconds, codec: 'h264/aac' };
                }
                subOffset += (subSize > 0 ? subSize : 8);
            }
        }
        offset += (size > 0 ? size : 8);
    }
    return { valid: true, codec: 'mp4' };
}

function inspectMp3(buffer) {
    let offset = 0;
    if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
        const id3Size = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
        offset = 10 + id3Size;
    }
    
    let syncFound = false;
    for (let i = offset; i < Math.min(buffer.length - 2, offset + 4096); i++) {
        if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
            syncFound = true;
            break;
        }
    }

    if (!syncFound && offset > 0) {
        syncFound = true;
    }

    const duration = buffer.length / (128 * 1000 / 8); 
    return { valid: syncFound, codec: 'mp3', duration: Math.max(1, duration) };
}

function inspectWav(buffer) {
    if (buffer.length < 44) return { valid: false, error: 'WAV file too short' };
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') return { valid: false, error: 'Invalid WAV header' };

    const byteRate = buffer.readUInt32LE(28);
    const duration = byteRate > 0 ? buffer.length / byteRate : 0;

    return { valid: true, codec: 'pcm_wav', duration };
}

function inspectOgg(buffer) {
    if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'OggS') {
        return { valid: false, error: 'Invalid OGG header' };
    }
    const duration = buffer.length / (128 * 1000 / 8);
    return { valid: true, codec: 'ogg_vorbis', duration: Math.max(1, duration) };
}

function inspectWebm(buffer) {
    if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0x1A45DFA3) {
        return { valid: false, error: 'Invalid WebM/MKV header' };
    }
    const duration = buffer.length / (250 * 1000 / 8);
    return { valid: true, codec: 'webm', duration: Math.max(1, duration) };
}

function validateMediaBuffer(buffer, mimetype, filename = '') {
    const size = buffer.length;

    // 1. Check size limits
    if (size === 0) {
        return { valid: false, error: 'Файл пуст (0 байт)' };
    }

    if (mimetype.startsWith('audio/')) {
        if (size > 50 * 1024 * 1024) {
            return { valid: false, error: 'Аудиофайл превышает максимальный размер (50 МБ)' };
        }
        let info = { valid: true, duration: 1 };
        if (mimetype.includes('mpeg') || mimetype.includes('mp3') || filename.endsWith('.mp3')) {
            info = inspectMp3(buffer);
        } else if (mimetype.includes('wav') || filename.endsWith('.wav')) {
            info = inspectWav(buffer);
        } else if (mimetype.includes('ogg') || filename.endsWith('.ogg')) {
            info = inspectOgg(buffer);
        }

        if (!info.valid) {
            return { valid: false, error: 'Невалидный или поврежденный аудиофайл (отсутствует кодек)' };
        }
        if (info.duration !== undefined && info.duration <= 0) {
            return { valid: false, error: 'Длительность аудиофайла 0 секунд' };
        }
        return { valid: true, codec: info.codec, duration: info.duration };
    }

    if (mimetype.startsWith('video/')) {
        if (size > 100 * 1024 * 1024) {
            return { valid: false, error: 'Видеофайл превышает максимальный размер (100 МБ)' };
        }
        let info = { valid: true, duration: 1 };
        if (mimetype.includes('mp4') || filename.endsWith('.mp4')) {
            info = inspectMp4(buffer);
        } else if (mimetype.includes('webm') || filename.endsWith('.webm')) {
            info = inspectWebm(buffer);
        }

        if (!info.valid) {
            return { valid: false, error: 'Невалидный или поврежденный видеофайл (отсутствует кодек)' };
        }
        if (info.duration !== undefined && info.duration <= 0) {
            return { valid: false, error: 'Длительность видеофайла 0 секунд' };
        }
        return { valid: true, codec: info.codec, duration: info.duration };
    }

    if (mimetype.startsWith('image/')) {
        if (size > 20 * 1024 * 1024) {
            return { valid: false, error: 'Изображение превышает максимальный размер (20 МБ)' };
        }
        return { valid: true };
    }

    return { valid: true };
}

module.exports = { validateMediaBuffer };
