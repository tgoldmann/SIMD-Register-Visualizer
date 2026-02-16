# SIMD Register Visualizer

**SIMD Register Visualizer** is a Visual Studio Code extension designed for C++ developers and Reverse Engineers. It provides a readable, real-time graphical view of CPU registers (General Purpose, SSE, and AVX) during GDB debugging sessions.

It specifically focuses on visualizing vector registers (XMM/YMM) in various data formats (Float, Double, Int8, Int32) and helps decode function arguments based on platform ABIs.

## Features

### 1. Function Argument Helper (ABI)
Debugging assembly or optimized code? This tool automatically maps registers to function arguments based on the standard calling conventions:
*   **Windows x64 (Fastcall):** Maps `RCX`, `RDX`, `R8`, `R9` (and corresponding XMMs).
*   **Linux/System V AMD64:** Maps `RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9`.
*   **Toggleable Formats:** View arguments as Pointers/Integers or Floating point values instantly.

### 2. Vector Register Visualization (SSE & AVX)
Stop staring at raw hex dumps. View your SIMD registers formatted as actual data arrays:
*   **XMM (128-bit) & YMM (256-bit)** support.
*   **Multiple Interpretations:**
    *   4x / 8x Float (32-bit)
    *   2x / 4x Double (64-bit)
    *   4x / 8x Int32
    *   16x / 32x Int8
*   **Color Coding:**
    *   <span style="color:#9cdcfe">**Green:**</span> Positive values
    *   <span style="color:#569cd6">**Blue:**</span> Negative values
    *   <span style="color:#ff6666">**Red:**</span> NaN / Infinity / Errors

### 3. General Purpose & MMX Registers
*   **GP Registers (RAX, RBX...):** View in Hex, Decimal, or Binary (useful for bitmasks).
*   **MMX (Legacy):** Visualized as 64-bit Hex or broken down into Int8/Int16/Int32 chunks.

### 4. Smart Data Fetching
*   Automatically detects if YMM registers are missing from the standard GDB output and force-fetches them individually via GDB commands.

## Requirements

*   **VS Code C/C++ Extension (`ms-vscode.cpptools`):** This extension relies on the active debug session provided by the C++ extension.
*   **GDB:** The extension issues `-exec info all-registers` commands. It is designed to work with **GDB** (MinGW, Linux GDB, etc.).
    *   *Note: usage with LLDB/MSVC debuggers is not currently supported as the commands are specific to GDB MI.*

## Usage

1.  Start a C/C++ Debugging Session.
2.  Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
3.  Run the command: **`SIMD Register Visualizer: Show`** (or type `viewerRegs.show`).
4.  A panel will open to the side. Stepping through code (`F10`/`F11`) will automatically refresh the register values.

## Extension Settings

This extension currently does not provide global settings. All configuration (Data types, ABI Platform, Base) is done directly within the Webview UI and persists while the panel is open.

## Known Issues

*   **Performance:** fetching all 16 YMM registers individually (if the bulk fetch fails) may add a slight delay when stepping through code on slow connections.
*   **Compatibility:** This relies on the output format of GDB. Significant changes to GDB output versions might require updates to the regex parsers.

## Release Notes

### 0.1.0
*   Initial release.
*   Support for GP, MMX, SSE (XMM), and AVX (YMM).
*   Windows and Linux ABI Helper.

---

**Enjoying the extension?**  
Please feel free to submit issues or suggestions on the repository.