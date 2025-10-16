/**
 * PIT (Partition Information Table) Parser
 * Port of PyOdin's pit.py
 */

class PitEntry {
    constructor() {
        this.binaryType = 0;
        this.deviceType = 0;
        this.partitionId = 0;
        this.partitionType = 0;
        this.filesystem = 0;
        this.startBlock = 0;
        this.numBlocks = 0;
        this.fileOffset = 0;
        this.fileSize = 0;
        this.partitionName = "";
        this.flashFilename = "";
        this.fotaFilename = "";
    }
    
    toString() {
        return `PitEntry(name='${this.partitionName}', id=${this.partitionId}, blocks=${this.numBlocks})`;
    }
}

class PitData {
    constructor() {
        this.magic = 0;
        this.count = 0;
        this.entries = [];
    }
    
    getEntryByName(name) {
        return this.entries.find(e => e.partitionName === name);
    }
    
    getEntryById(partitionId) {
        return this.entries.find(e => e.partitionId === partitionId);
    }
    
    toString() {
        return `PitData(entries=${this.entries.length})`;
    }
}

class PitParser {
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    
    log(message) {
        if (this.verbose) {
            log(`[PitParser] ${message}`, 'info');
        }
    }
    
    /**
     * Parse PIT data
     */
    parse(pitData) {
        if (pitData.length < PIT_HEADER_SIZE) {
            throw new Error("PIT data too small");
        }
        
        this.log(`Parsing PIT data (${pitData.length} bytes)...`);
        
        // Parse header
        const magic = LEToNumber(pitData, 0, 4);
        const count = LEToNumber(pitData, 4, 4);
        
        if (magic !== PIT_MAGIC) {
            throw new Error(`Invalid PIT magic: 0x${magic.toString(16).padStart(8, '0')} (expected 0x${PIT_MAGIC.toString(16).padStart(8, '0')})`);
        }
        
        this.log(`PIT magic: 0x${magic.toString(16).padStart(8, '0')}, entries: ${count}`);
        
        const pit = new PitData();
        pit.magic = magic;
        pit.count = count;
        
        // Parse entries
        let offset = PIT_HEADER_SIZE;
        
        for (let i = 0; i < count; i++) {
            if (offset + PIT_ENTRY_SIZE > pitData.length) {
                this.log(`Warning: Truncated PIT data at entry ${i}`);
                break;
            }
            
            const entry = this.parseEntry(pitData, offset);
            pit.entries.push(entry);
            
            this.log(`  [${i}] ${entry.partitionName} (ID: ${entry.partitionId}, blocks: ${entry.numBlocks})`);
            
            offset += PIT_ENTRY_SIZE;
        }
        
        this.log(`Parsed ${pit.entries.length} PIT entries`);
        
        return pit;
    }
    
    /**
     * Parse single PIT entry
     */
    parseEntry(data, offset) {
        const entry = new PitEntry();
        
        // Parse entry fields (based on PIT format)
        entry.binaryType = LEToNumber(data, offset + 0, 4);
        entry.deviceType = LEToNumber(data, offset + 4, 4);
        entry.partitionId = LEToNumber(data, offset + 8, 4);
        entry.partitionType = LEToNumber(data, offset + 12, 4);
        entry.filesystem = LEToNumber(data, offset + 16, 4);
        entry.startBlock = LEToNumber(data, offset + 20, 4);
        entry.numBlocks = LEToNumber(data, offset + 24, 4);
        entry.fileOffset = LEToNumber(data, offset + 28, 4);
        entry.fileSize = LEToNumber(data, offset + 32, 4);
        
        // Parse strings (null-terminated, max 32 bytes each)
        entry.partitionName = readString(data, offset + 36, 32);
        entry.flashFilename = readString(data, offset + 68, 32);
        entry.fotaFilename = readString(data, offset + 100, 32);
        
        return entry;
    }
    
    /**
     * Serialize PIT data back to bytes
     */
    serialize(pitData) {
        const totalSize = PIT_HEADER_SIZE + pitData.entries.length * PIT_ENTRY_SIZE;
        const buffer = new Uint8Array(totalSize);
        
        // Write header
        buffer.set(numberToLE(pitData.magic, 4), 0);
        buffer.set(numberToLE(pitData.count, 4), 4);
        // Fill rest of header with zeros (already done by Uint8Array constructor)
        
        // Write entries
        let offset = PIT_HEADER_SIZE;
        for (const entry of pitData.entries) {
            this.serializeEntry(entry, buffer, offset);
            offset += PIT_ENTRY_SIZE;
        }
        
        return buffer;
    }
    
    /**
     * Serialize single PIT entry
     */
    serializeEntry(entry, buffer, offset) {
        buffer.set(numberToLE(entry.binaryType, 4), offset + 0);
        buffer.set(numberToLE(entry.deviceType, 4), offset + 4);
        buffer.set(numberToLE(entry.partitionId, 4), offset + 8);
        buffer.set(numberToLE(entry.partitionType, 4), offset + 12);
        buffer.set(numberToLE(entry.filesystem, 4), offset + 16);
        buffer.set(numberToLE(entry.startBlock, 4), offset + 20);
        buffer.set(numberToLE(entry.numBlocks, 4), offset + 24);
        buffer.set(numberToLE(entry.fileOffset, 4), offset + 28);
        buffer.set(numberToLE(entry.fileSize, 4), offset + 32);
        
        // Write strings (null-terminated, max 32 bytes)
        this.writeString(buffer, offset + 36, entry.partitionName, 32);
        this.writeString(buffer, offset + 68, entry.flashFilename, 32);
        this.writeString(buffer, offset + 100, entry.fotaFilename, 32);
    }
    
    /**
     * Write string to buffer (null-terminated, fixed max length)
     */
    writeString(buffer, offset, str, maxLength) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const len = Math.min(bytes.length, maxLength - 1);
        buffer.set(bytes.slice(0, len), offset);
        buffer[offset + len] = 0;  // Null terminator
    }
}

