/**
 * Constants and opcodes for Odin protocol
 * WebUSB port of PyOdin constants
 */

// Samsung USB Vendor ID
const SAMSUNG_VENDOR_ID = 0x04E8;

// Samsung Product IDs for Download Mode
const SAMSUNG_DOWNLOAD_MODE_PIDS = [
    0x685D,  // Download mode
    0x68C3,  // Newer devices
];

// USB Endpoints
const USB_ENDPOINT_OUT = 0x02;
const USB_ENDPOINT_IN = 0x81;

// USB Transfer sizes
const USB_PACKET_SIZE = 512;
const USB_MAX_PACKET_SIZE = 0x200000;  // 2MB

// Odin Protocol Commands/Requests
const OdinCommand = {
    HANDSHAKE: 0x64,
    SETUP: 0x65,
    PIT_TRANSFER: 0x66,
    FILE_TRANSFER: 0x67,
    DUMP: 0x68,
    END_SESSION: 0x69,
    REBOOT: 0x6A,
    
    // Sub-commands
    REQUEST_DEVICEINFO: 0x00,
    REQUEST_PITINFO: 0x01,
    REQUEST_CHIPINFO: 0x02,
    REQUEST_DUMP: 0x03,
    
    // Responses
    RESPONSE_PASS: 0x00,
    RESPONSE_FAIL: 0x01,
    RESPONSE_DATA: 0x02
};

const OdinPacketType = {
    REQUEST: 0x00,
    DATA: 0x01,
    RESPONSE: 0x02
};

// Protocol constants
const ODIN_PROTOCOL_VERSION = 4;
const ODIN_MAGIC = new TextEncoder().encode("ODIN");
const ODIN_PACKET_HEADER_SIZE = 8;

// Firmware file signatures
const TAR_SIGNATURE = new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72]);  // "ustar"
const GZIP_SIGNATURE = new Uint8Array([0x1F, 0x8B]);
const LZ4_SIGNATURE = new Uint8Array([0x04, 0x22, 0x4D, 0x18]);
const MD5_FILE_EXTENSION = ".md5";

// PIT (Partition Information Table)
const PIT_MAGIC = 0x12349876;
const PIT_HEADER_SIZE = 28;
const PIT_ENTRY_SIZE = 132;

// Transfer modes
const TransferMode = {
    NORMAL: 0x00,
    COMPRESSED: 0x01,
    ENCRYPTED: 0x02
};

// Device response codes
const DeviceResponse = {
    SUCCESS: 0x00,
    FAIL: 0x01,
    VERIFY_FAIL: 0x02,
    WRITE_PROTECTION: 0x03,
    INVALID_DATA: 0x04
};

// Timeouts (in seconds) - from odin4.c
const TIMEOUT_CONNECT = 5;
const TIMEOUT_HANDSHAKE = 60;
const TIMEOUT_TRANSFER = 60;
const TIMEOUT_WRITE = 60;
const TIMEOUT_READ = 60;

// Buffer sizes
const BUFFER_SIZE = 512 * 1024;  // 512KB
const MAX_FIRMWARE_SIZE = 8 * 1024 * 1024 * 1024;  // 8GB

// Partition types
const PartitionType = {
    BOOTLOADER: 0x00,
    PIT: 0x01,
    KERNEL: 0x02,
    RECOVERY: 0x03,
    SYSTEM: 0x04,
    CACHE: 0x05,
    USERDATA: 0x06,
    MODEM: 0x07,
    
    NAMES: {
        0x00: "BOOTLOADER",
        0x01: "PIT",
        0x02: "KERNEL",
        0x03: "RECOVERY",
        0x04: "SYSTEM",
        0x05: "CACHE",
        0x06: "USERDATA",
        0x07: "MODEM"
    }
};

// Known partition names to types mapping
const PARTITION_NAME_MAP = {
    "boot.img": PartitionType.KERNEL,
    "recovery.img": PartitionType.RECOVERY,
    "system.img": PartitionType.SYSTEM,
    "cache.img": PartitionType.CACHE,
    "userdata.img": PartitionType.USERDATA,
    "modem.bin": PartitionType.MODEM,
    "sboot.bin": PartitionType.BOOTLOADER
};

// Firmware file extensions
const FIRMWARE_EXTENSIONS = [
    ".tar",
    ".tar.md5",
    ".tar.gz",
    ".bin",
    ".img"
];

// Crypto constants
const MD5_HASH_SIZE = 16;
const SHA256_HASH_SIZE = 32;

// Progress callback intervals
const PROGRESS_UPDATE_INTERVAL = 0.5;  // seconds

