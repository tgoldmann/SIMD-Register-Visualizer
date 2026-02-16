"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
// @ts-ignore
const vscode = require("vscode");
function activate(context) {
    let panel = undefined;
    // Platform detection
    const defaultPlatform = process.platform === 'win32' ? 'win' : 'lin';
    async function refreshRegisters() {
        const session = vscode.debug.activeDebugSession;
        if (session && panel) {
            try {
                // Fetch all registers at once
                const response = await session.customRequest('evaluate', {
                    expression: "-exec info all-registers",
                    context: "repl"
                });
                let rawOutput = response.result || "";
                // Fix for missing YMM registers (some GDB versions in VSCode do not return them in 'info all-registers')
                if (!rawOutput.includes("ymm0")) {
                    const promises = [];
                    for (let i = 0; i < 16; i++) {
                        promises.push(session.customRequest('evaluate', {
                            expression: `-exec p $ymm${i}`,
                            context: "repl"
                        }).then(r => ({ id: i, val: r.result }), () => ({ id: i, val: null })));
                    }
                    const results = await Promise.all(promises);
                    let extraData = "";
                    results.forEach(res => {
                        if (res.val) {
                            let cleanVal = res.val;
                            if (cleanVal.includes("="))
                                cleanVal = cleanVal.substring(cleanVal.indexOf("=") + 1).trim();
                            extraData += `\nymm${res.id} ${cleanVal}`;
                        }
                    });
                    if (extraData)
                        rawOutput += "\n--- FORCED YMM FETCH ---" + extraData;
                }
                panel.webview.postMessage({ command: 'update', raw: rawOutput });
            }
            catch (err) {
                console.error(err);
            }
        }
    }
    let disposable = vscode.commands.registerCommand('viewerRegs.show', () => {
        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
        }
        else {
            panel = vscode.window.createWebviewPanel('viewerRegs', 'SIMD Register Visualizer', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
            panel.webview.html = getWebviewContent(defaultPlatform);
            refreshRegisters();
            panel.onDidDispose(() => { panel = undefined; });
        }
    });
    vscode.debug.onDidChangeActiveStackItem(() => { refreshRegisters(); });
    context.subscriptions.push(disposable);
}
function getWebviewContent(defaultPlatform) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            :root { --bg: #1e1e1e; --text: #ccc; --border: #3e3e3e; --header-bg: #252526; --accent: #007acc; --hover: #2a2d2e; }
            body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 10px; font-size: 13px; }
            
            details { margin-bottom: 8px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; background: #1a1a1a; }
            summary { background: var(--header-bg); padding: 8px 12px; cursor: pointer; font-weight: bold; color: #d4d4d4; display: flex; justify-content: space-between; outline: none; user-select: none; }
            summary:hover { background: var(--hover); }
            
            .controls { padding: 6px; border-bottom: 1px solid var(--border); background: #222; display: flex; gap: 15px; align-items: center; font-size: 11px; flex-wrap: wrap; }
            .control-group { display: flex; align-items: center; gap: 5px; }
            select { background: #333; color: white; border: 1px solid #555; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
            label { color: #888; cursor: pointer; }
            input[type="checkbox"] { cursor: pointer; }

            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            td { padding: 4px; vertical-align: middle; border-bottom: 1px solid #2a2a2a; }
            td:first-child { width: 60px; font-weight: bold; color: #569cd6; text-align: right; padding-right: 10px; border-right: 1px solid var(--border); }
            
            .grid { display: flex; gap: 2px; width: 100%; }
            .cell { flex: 1; background: #2d2d2d; border: 1px solid #3d3d3d; text-align: center; font-family: 'Consolas', monospace; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 24px; color: #b5cea8; transition: background 0.2s; }
            .cell:hover { border-color: #888; z-index: 10; }
            
            .cell.pos { background: #0e2a0e; border-color: #1e4a1e; color: #9cdcfe; }
            .cell.neg { background: #0e1e2a; border-color: #1e3e4a; color: #569cd6; }
            .cell.err { background: #2a0e0e; border-color: #4a1e1e; color: #ff6666; font-weight: bold; }
            .cell.flo { background: #1a1a3a; border-color: #2a2a5a; color: #ce9178; } /* Color for Floats */
            
            .idx { font-size: 8px; color: #666; position: absolute; top: 0; left: 2px; }
            .val { font-size: 11px; z-index: 2; white-space: nowrap; padding: 0 2px; }
            .gp-val { font-family: 'Consolas', monospace; color: #9cdcfe; padding-left: 10px; }
            
            #table-abi td:first-child { width: 40px; color: #ccc; background: transparent; border-right: none; }
            .abi-reg { font-weight: bold; color: #ce9178; display: inline-block; width: 35px; }
            .abi-val { color: #9cdcfe; font-family: 'Consolas', monospace; font-size: 11px; }
            .abi-row { display: flex; align-items: center; justify-content: space-between; }
            
            /* FPU Specific */
            .fpu-val { color: #ce9178; font-family: 'Consolas', monospace; }
            .fpu-raw { color: #666; font-size: 10px; font-family: 'Consolas', monospace; margin-left: 10px; }
            .flags-container { font-family: 'Consolas', monospace; font-size: 10px; color: #888; margin-top: 5px; }
            .flag-on { color: #569cd6; font-weight: bold; }
            .flag-off { color: #444; }

            pre { font-size: 10px; color: #666; padding: 10px; margin: 0; overflow: auto; max-height: 200px; background: #111; border-top: 1px solid #333; }
        </style>
    </head>
    <body>
        
        <details open>
            <summary style="color: #dcdcaa;">ABI Helper (Function Arguments)</summary>
            <div class="controls">
                <div class="control-group">
                    <label>OS:</label>
                    <select id="abi-platform" onchange="render()">
                        <option value="win" ${defaultPlatform === 'win' ? 'selected' : ''}>Windows</option>
                        <option value="lin" ${defaultPlatform === 'lin' ? 'selected' : ''}>Linux</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Int:</label>
                    <select id="abi-int-fmt" onchange="render()">
                        <option value="hex">Hex</option>
                        <option value="dec">Dec</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Float:</label>
                    <select id="abi-float-fmt" onchange="render()">
                        <option value="float">Float</option>
                        <option value="double">Double</option>
                        <option value="hex">Hex</option>
                    </select>
                </div>
            </div>
            <table id="table-abi"></table>
        </details>

        <details>
            <summary>GP Registers (64-bit)</summary>
            <div class="controls">
                <div class="control-group">
                    <label>Format:</label>
                    <select id="fmt-gp" onchange="render()"><option value="hex">Hex</option><option value="dec">Dec</option><option value="bin">Bin</option></select>
                </div>
            </div>
            <table id="table-gp"></table>
        </details>

        <details>
            <summary>FPU Registers (x87)</summary>
            <div class="controls">
                 <div class="control-group"><label>View:</label> <span>ST0-ST7 (80-bit Extended)</span></div>
            </div>
            <div id="fpu-flags" class="controls" style="display:block; border-top:1px solid #333;"></div>
            <table id="table-fpu"></table>
        </details>

        <details>
            <summary>MMX Registers (ST0-7)</summary>
            <div class="controls">
                <div class="control-group">
                    <label>Interpretation:</label>
                    <select id="fmt-mmx" onchange="render()"><option value="hex">Hex 64-bit</option><option value="int32">2x Int32</option><option value="int16">4x Int16</option><option value="int8">8x Int8</option></select>
                </div>
                <div class="control-group"><input type="checkbox" id="col-mmx" checked onchange="render()"><label for="col-mmx">Colors</label></div>
            </div>
            <table id="table-mmx"></table>
        </details>

        <details open>
            <summary>SSE Registers (XMM 128-bit)</summary>
            <div class="controls">
                <div class="control-group">
                    <label>Type:</label>
                    <select id="fmt-sse" onchange="render()">
                        <option value="auto" selected>★ Auto Detect</option>
                        <option value="v4_float">4x Float</option>
                        <option value="v2_double">2x Double</option>
                        <option value="v4_int32">4x Int32</option>
                        <option value="v16_int8">16x Int8</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Display:</label>
                    <select id="base-sse" onchange="render()"><option value="dec">Decimal</option><option value="hex">Hex</option></select>
                </div>
                <div class="control-group"><input type="checkbox" id="col-sse" checked onchange="render()"><label for="col-sse">Colors</label></div>
            </div>
            <table id="table-sse"></table>
        </details>

        <details open>
            <summary>AVX Registers (YMM 256-bit)</summary>
            <div class="controls">
                <div class="control-group">
                    <label>Type:</label>
                    <select id="fmt-avx" onchange="render()">
                        <option value="auto" selected>★ Auto Detect</option>
                        <option value="v8_float">8x Float</option>
                        <option value="v4_double">4x Double</option>
                        <option value="v8_int32">8x Int32</option>
                        <option value="v32_int8">32x Int8</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Display:</label>
                    <select id="base-avx" onchange="render()"><option value="dec">Decimal</option><option value="hex">Hex</option></select>
                </div>
                <div class="control-group"><input type="checkbox" id="col-avx" checked onchange="render()"><label for="col-avx">Colors</label></div>
            </div>
            <table id="table-avx"></table>
        </details>

        <details>
            <summary>Raw GDB Output</summary>
            <pre id="raw-out"></pre>
        </details>

        <script>
            let rawData = "";
            let parsedRegs = {};
            let parsedMMX = {};
            let parsedFPU = {}; // New: FPU Data
            let parsedStatus = { fstat: 0, fctrl: 0 }; // New: FPU Status

            const abiMapWin = [
                { id: 1, int: 'rcx', float: 'xmm0' },
                { id: 2, int: 'rdx', float: 'xmm1' },
                { id: 3, int: 'r8',  float: 'xmm2' },
                { id: 4, int: 'r9',  float: 'xmm3' }
            ];
            const abiMapLin = [
                { id: 1, int: 'rdi', float: 'xmm0' },
                { id: 2, int: 'rsi', float: 'xmm1' },
                { id: 3, int: 'rdx', float: 'xmm2' },
                { id: 4, int: 'rcx', float: 'xmm3' },
                { id: 5, int: 'r8',  float: 'xmm4' },
                { id: 6, int: 'r9',  float: 'xmm5' }
            ];

            window.addEventListener('message', event => {
                if (event.data.command === 'update') {
                    rawData = event.data.raw;
                    document.getElementById('raw-out').innerText = rawData;
                    parseData();
                    render();
                }
            });

            // --- CONVERSION ---
            function hexToFloat32(hex) { var int = parseInt(hex, 16); var view = new DataView(new ArrayBuffer(4)); view.setUint32(0, int); return view.getFloat32(0); }
            function hexToFloat64(hex) { var bigInt = BigInt(hex); var view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, bigInt); return view.getFloat64(0); }
            function floatToHex(val) { const getHex = (i) => ('00' + i.toString(16)).slice(-2); var view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, Number(val)); return "0x" + Array.apply(null, { length: 4 }).map((_, i) => getHex(view.getUint8(i))).join('').toUpperCase(); }
            function doubleToHex(val) { const getHex = (i) => ('00' + i.toString(16)).slice(-2); var view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Number(val)); return "0x" + Array.apply(null, { length: 8 }).map((_, i) => getHex(view.getUint8(i))).join('').toUpperCase(); }
            function hexToSignedInt(hex, bitWidth) { let val = parseInt(hex, 16); let maxVal = Math.pow(2, bitWidth); if (val >= maxVal / 2) val -= maxVal; return val; }

            // Heuristic to detect if a hex value looks like a float
            function detectNumberType(hexVal, forceDouble) {
                // 0 is valid for all
                if (parseInt(hexVal, 16) === 0) return 'zero';

                // Try Float32
                if (!forceDouble) {
                    let f = hexToFloat32(hexVal);
                    // Check for NaN, Inf
                    if (isNaN(f)) return 'int'; // Valid ints can be NaN floats
                    if (!isFinite(f)) return 'int'; // Likely random data or huge int
                    // Check magnitude. Valid physics/math code usually uses 1e-10 to 1e+10.
                    // If exponent is extremely small or large, it's likely an integer/pointer.
                    let abs = Math.abs(f);
                    if (abs > 1e-15 && abs < 1e15) return 'float'; 
                }

                // Try Double
                let d = hexToFloat64(hexVal);
                if (!isNaN(d) && isFinite(d)) {
                    let absD = Math.abs(d);
                    if (absD > 1e-15 && absD < 1e15) return 'double';
                }
                
                return 'int';
            }

            function getActualNumber(valStr, type) {
                let clean = valStr.trim().toLowerCase();
                if (clean.includes("nan")) return NaN;
                if (clean.includes("inf")) return Infinity;
                let isHex = clean.startsWith("0x");
                if (isHex) {
                    if (type.includes('float')) return hexToFloat32(clean);
                    if (type.includes('double')) return hexToFloat64(clean);
                    let bitWidth = 32;
                    if (type.includes('int8')) bitWidth = 8; else if (type.includes('int16')) bitWidth = 16; else if (type.includes('int64')) bitWidth = 64;
                    return hexToSignedInt(clean, bitWidth);
                }
                return Number(clean);
            }

            function formatNumber(valStr, type, displayBase) {
                let clean = valStr.trim();
                let isHexInput = clean.startsWith("0x");
                if (displayBase === 'dec') {
                    if (isHexInput) {
                        if (type.includes('float')) return hexToFloat32(clean).toPrecision(6).replace(/\\.?0+$/, "");
                        if (type.includes('double')) return hexToFloat64(clean).toPrecision(12).replace(/\\.?0+$/, "");
                        // Int fallback
                        return parseInt(clean, 16).toString();
                    }
                    return clean;
                }
                if (displayBase === 'hex') {
                    if (isHexInput) return clean.toUpperCase();
                    if (type.includes('float')) return floatToHex(clean);
                    if (type.includes('double')) return doubleToHex(clean);
                    let num = Number(clean);
                    if (!isNaN(num)) { if (num < 0) num = 0xFFFFFFFF + num + 1; return "0x" + num.toString(16).toUpperCase(); }
                }
                return clean;
            }

            function parseData() {
                parsedRegs = {}; parsedMMX = {}; parsedFPU = {};
                const lines = rawData.split(/\\\\n|\\n/);
                lines.forEach(line => {
                    line = line.trim();
                    if (!line || line.startsWith('info') || line.startsWith('---')) return;
                    
                    // GP Registers
                    let gpM = line.match(/^(\\w{2,4})\\s+(0x[0-9a-f]+)\\s+(-?\\d+)/i);
                    if (gpM) { 
                        parsedRegs[gpM[1]] = { hex: gpM[2], dec: gpM[3] }; 
                        // Capture status registers
                        if (gpM[1] === 'fstat') parsedStatus.fstat = parseInt(gpM[2], 16);
                        if (gpM[1] === 'fctrl') parsedStatus.fctrl = parseInt(gpM[2], 16);
                        return; 
                    }

                    // FPU / MMX Registers
                    // Matches: st0  1.2345  (raw 0x...)
                    let stMatch = line.match(/^(st\\d)\\s+(.*?)\\s+\\(raw\\s+(0x[0-9a-f]+)\\)/i);
                    if (stMatch) {
                        let name = stMatch[1];
                        let valStr = stMatch[2];
                        let rawHex = stMatch[3];
                        
                        // FPU Data (Strings from GDB)
                        parsedFPU[name] = { val: valStr, raw: rawHex };

                        // MMX Data (Lower 64-bits of mantissa)
                        let mmName = name.replace('st', 'mm'); 
                        parsedMMX[mmName] = rawHex.replace('0x', '').slice(-16).padStart(16, '0'); 
                        return;
                    }

                    // SSE/AVX Vectors
                    if (line.includes('{')) {
                        let parts = line.split(/\\s+/);
                        let name = parts[0];
                        if (name.startsWith('$')) name = parts[2]; 
                        let rest = line.substring(line.indexOf('{'));
                        parsedRegs[name] = {};
                        const extract = (key) => { let regex = new RegExp(key + '\\\\s*=\\\\s*\\\\{([^}]+)\\\\}'); let match = rest.match(regex); return match ? match[1].split(',').map(s => s.trim()) : null; };
                        parsedRegs[name]['v4_float'] = extract('v4_float');
                        parsedRegs[name]['v8_float'] = extract('v8_float');
                        parsedRegs[name]['v4_int32'] = extract('v4_int32');
                        parsedRegs[name]['v8_int32'] = extract('v8_int32');
                        parsedRegs[name]['v16_int8'] = extract('v16_int8');
                        parsedRegs[name]['v32_int8'] = extract('v32_int8');
                        parsedRegs[name]['v2_double'] = extract('v2_double');
                        parsedRegs[name]['v4_double'] = extract('v4_double');
                    }
                });
            }

            function render() {
                renderABI();
                renderGP(); 
                renderFPU();
                renderMMX();
                renderSIMD('table-sse', 'xmm', document.getElementById('fmt-sse').value, document.getElementById('base-sse').value, document.getElementById('col-sse').checked);
                renderSIMD('table-avx', 'ymm', document.getElementById('fmt-avx').value, document.getElementById('base-avx').value, document.getElementById('col-avx').checked);
            }

            function renderFPU() {
                const table = document.getElementById('table-fpu');
                const flagsDiv = document.getElementById('fpu-flags');
                
                // Render Registers
                let html = "";
                for(let i=0; i<8; i++) {
                    let name = 'st' + i;
                    if(parsedFPU[name]) {
                        html += \`<tr>
                            <td>\${name.toUpperCase()}</td>
                            <td>
                                <span class="fpu-val">\${parsedFPU[name].val}</span>
                                <span class="fpu-raw">\${parsedFPU[name].raw}</span>
                            </td>
                        </tr>\`;
                    }
                }
                table.innerHTML = html;

                // Render Flags
                if (parsedStatus.fstat) {
                    const s = parsedStatus.fstat;
                    const c = parsedStatus.fctrl;
                    const f = (val, bit, txt) => \`<span class="\${(val & (1<<bit)) ? 'flag-on' : 'flag-off'}" style="margin-right:8px">\${txt}</span>\`;
                    
                    let fstatHtml = "<b>Status:</b> " + 
                        f(s, 15, 'B') + f(s, 14, 'C3') + f(s, 10, 'C2') + f(s, 9, 'C1') + f(s, 8, 'C0') + " | " +
                        f(s, 7, 'IR') + f(s, 5, 'PE') + f(s, 4, 'UE') + f(s, 3, 'OE') + f(s, 2, 'ZE') + f(s, 1, 'DE') + f(s, 0, 'IE');
                        
                    let fctrlHtml = "<b>Control:</b> " + 
                        f(c, 10, 'PC') + f(c, 8, 'RC') + " | " +
                        f(c, 5, 'PM') + f(c, 4, 'UM') + f(c, 3, 'OM') + f(c, 2, 'ZM') + f(c, 1, 'DM') + f(c, 0, 'IM');

                    flagsDiv.innerHTML = \`<div class="flags-container">\${fstatHtml}</div><div class="flags-container">\${fctrlHtml}</div>\`;
                }
            }

            function renderABI() {
                const table = document.getElementById('table-abi');
                const platform = document.getElementById('abi-platform').value;
                const intFmt = document.getElementById('abi-int-fmt').value;
                const floatFmt = document.getElementById('abi-float-fmt').value; 
                
                const mapping = platform === 'win' ? abiMapWin : abiMapLin;
                let html = "<tr><th>Arg</th><th>Integer / Pointer</th><th>Float / Double</th></tr>";
                
                mapping.forEach(m => {
                    let intVal = "???";
                    if (parsedRegs[m.int]) intVal = formatNumber(parsedRegs[m.int].hex, 'int64', intFmt);
                    
                    let floatVal = "???";
                    let arrKey = (floatFmt === 'double') ? 'v2_double' : 'v4_float';
                    if (floatFmt === 'double') arrKey = ['v2_double', 'v4_double'];
                    else arrKey = ['v4_float', 'v8_float'];

                    const getData = (regName, keys) => {
                        if (!parsedRegs[regName]) return null;
                        for(let k of keys) { if (parsedRegs[regName][k]) return parsedRegs[regName][k]; }
                        return null;
                    };

                    let fArr = getData(m.float, Array.isArray(arrKey) ? arrKey : [arrKey]);
                    if (!fArr && parsedRegs['ymm'+m.float.substring(3)]) fArr = getData('ymm'+m.float.substring(3), Array.isArray(arrKey) ? arrKey : [arrKey]);

                    if (fArr && fArr.length > 0) {
                        let displayType = floatFmt === 'double' ? 'double' : 'float';
                        let displayBase = floatFmt === 'hex' ? 'hex' : 'dec';
                        floatVal = formatNumber(fArr[0], displayType, displayBase);
                    }

                    html += \`<tr>
                        <td>#\${m.id}</td>
                        <td><span class="abi-reg">\${m.int.toUpperCase()}</span> <span class="abi-val">\${intVal}</span></td>
                        <td><span class="abi-reg">\${m.float.toUpperCase()}</span> <span class="abi-val">\${floatVal}</span></td>
                    </tr>\`;
                });
                table.innerHTML = html;
            }

            function renderGP() {
                const table = document.getElementById('table-gp');
                const fmt = document.getElementById('fmt-gp').value;
                const regs = ["rax","rbx","rcx","rdx","rsi","rdi","rbp","rsp","r8","r9","r10","r11","r12","r13","r14","r15","rip","eflags"];
                let html = "";
                regs.forEach(r => {
                    if (!parsedRegs[r]) return;
                    let val = parsedRegs[r].hex;
                    if (fmt === 'dec') val = parsedRegs[r].dec;
                    if (fmt === 'bin') val = parseInt(parsedRegs[r].hex, 16).toString(2).padStart(64, '0').replace(/(.{8})/g, '$1 ').trim();
                    html += \`<tr><td>\${r}</td><td class="gp-val">\${val}</td></tr>\`;
                });
                table.innerHTML = html;
            }

            function renderMMX() {
                const table = document.getElementById('table-mmx');
                const fmt = document.getElementById('fmt-mmx').value;
                const useColor = document.getElementById('col-mmx').checked;
                let html = "";
                for(let i=0; i<8; i++) {
                    let name = 'mm' + i;
                    let hex = parsedMMX[name];
                    if (!hex) continue;
                    let cells = "";
                    if (fmt === 'hex') {
                        cells = \`<div class="cell">0x\${hex}</div>\`;
                    } else {
                        let bitWidth = 8;
                        if (fmt === 'int16') bitWidth = 16;
                        if (fmt === 'int32') bitWidth = 32;
                        let charWidth = bitWidth / 4; 
                        for(let k=0; k<16; k+=charWidth) {
                            let chunk = hex.substring(k, k+charWidth);
                            let val = hexToSignedInt(chunk, bitWidth);
                            let colorClass = "";
                            if (useColor) {
                                if (val > 0) colorClass = "pos";
                                else if (val < 0) colorClass = "neg";
                            }
                            cells += \`<div class="cell \${colorClass}"><span class="val">\${val}</span></div>\`;
                        }
                    }
                    html += \`<tr><td>\${name}</td><td><div class="grid">\${cells}</div></td></tr>\`;
                }
                table.innerHTML = html;
            }

            function renderSIMD(tableId, prefix, format, base, useColor) {
                const table = document.getElementById(tableId);
                let html = "";
                
                // Auto Detect Logic
                let isAuto = format === 'auto';
                let reqFormat = isAuto ? (prefix === 'ymm' ? 'v8_float' : 'v4_float') : format; // default data pull

                for(let i=0; i<16; i++) {
                    let name = prefix + i;
                    let regObj = parsedRegs[name];
                    let isFallback = false;
                    
                    // Fallback logic (pull YMM data for XMM request if missing)
                    if (!regObj && prefix === 'xmm' && parsedRegs['ymm'+i]) {
                        regObj = parsedRegs['ymm'+i];
                        isFallback = true; // handled below
                    } else if (!regObj && prefix === 'ymm' && parsedRegs['xmm'+i]) {
                        // Expansion fallback (XMM displayed in YMM view)
                        regObj = parsedRegs['xmm'+i];
                        isFallback = true;
                    }

                    if (regObj) {
                        let detectedMode = 'int'; // int, float, double
                        let activeFormat = reqFormat;
                        
                        // --- Smart Autodetection ---
                        if (isAuto) {
                            // Pull 32-bit integer view to analyze raw bits
                            let rawInts = regObj[prefix === 'ymm' ? 'v8_int32' : 'v4_int32'];
                            // Fallback for XMM in YMM view
                            if (!rawInts && prefix === 'ymm') rawInts = regObj['v4_int32']; 

                            if (rawInts) {
                                let floatScore = 0;
                                let doubleScore = 0;
                                // Simple heuristic: check first 2 elements
                                for(let k=0; k<Math.min(rawInts.length, 4); k++) {
                                    // Convert signed int string to hex for detection
                                    let valInt = parseInt(rawInts[k]);
                                    let hexStr = (valInt >>> 0).toString(16).padStart(8, '0');
                                    let type = detectNumberType(hexStr, false);
                                    if (type === 'float') floatScore++;
                                    if (type === 'zero') floatScore += 0.5;
                                }
                                if (floatScore >= 1) detectedMode = 'float';
                                else detectedMode = 'int'; 
                                // TODO: Double detection would require 64-bit int view analysis
                            }
                            
                            // Map detected mode to format string
                            if (detectedMode === 'float') activeFormat = prefix === 'ymm' ? 'v8_float' : 'v4_float';
                            else activeFormat = prefix === 'ymm' ? 'v8_int32' : 'v4_int32';
                        } else {
                            activeFormat = format;
                        }

                        // --- Data Extraction ---
                        let data = regObj[activeFormat];
                        
                        // Handle formatting mismatches (e.g. asking for v8_float on an XMM register)
                        if (!data && prefix === 'xmm' && activeFormat.includes('v8')) activeFormat = activeFormat.replace('v8', 'v4');
                        if (!data && prefix === 'ymm' && regObj['v4_float'] && activeFormat.includes('v8')) {
                            // Fallback: we have XMM data but want YMM. Pad it?
                            data = regObj['v4_float']; // Just show what we have
                            isFallback = true;
                        }
                        
                        // Final retry
                        data = regObj[activeFormat];

                        if (data) {
                            let cols = data.length;
                            // Fix grid for 8/16/32 items
                            let gridCols = cols;
                            if (isFallback && prefix === 'ymm') gridCols = cols * 2; // visual filler

                            let cells = "";
                            if (isFallback && prefix === 'ymm') {
                                for(let k=0; k<cols; k++) cells += \`<div class="cell" style="background:#222;color:#444;border-style:dashed;">N/A</div>\`;
                            }

                            data.forEach((valStr, idx) => {
                                let displayVal = formatNumber(valStr, activeFormat, base);
                                let colorClass = "";
                                if (useColor) {
                                    if (activeFormat.includes('float') || activeFormat.includes('double')) {
                                        colorClass = "flo"; // Use specific color for detected floats
                                        let numVal = getActualNumber(valStr, activeFormat);
                                        if (isNaN(numVal) || !isFinite(numVal)) colorClass = "err";
                                    } else {
                                        let numVal = getActualNumber(valStr, activeFormat);
                                        if (numVal > 0) colorClass = "pos";
                                        else if (numVal < 0) colorClass = "neg";
                                    }
                                }
                                cells += \`<div class="cell \${colorClass}"><span class="idx">\${idx}</span><span class="val">\${displayVal}</span></div>\`;
                            });

                            let label = name + (isFallback ? '*' : '');
                            html += \`<tr><td>\${label}</td><td><div class="grid" style="grid-template-columns: repeat(\${gridCols}, 1fr);">\${cells}</div></td></tr>\`;
                        }
                    }
                }
                table.innerHTML = html;
            }
        </script>
    </body>
    </html>`;
}
