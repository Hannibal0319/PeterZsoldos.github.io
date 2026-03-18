// Application state
const state = {
    sourceImage: null, // ImageData
    width: 0,
    height: 0,
    scalesPerOctave: 3,
    initialSigma: 1.6,
    numOctaves: 4, // Fixed for simplicity
    
    // Pyramids
    gaussianPyramid: [], // Array of Octaves, each octave is an array of Float32Arrays
    dogPyramid: [],      // Array of Octaves, each an array of Float32Arrays
    sigmas: [],          // The effective sigma for each scale in an octave
    
    chartInstance: null
};

// DOM Elements
const els = {
    imageUpload: document.getElementById('imageUpload'),
    fileName: document.getElementById('fileName'),
    scalesInput: document.getElementById('scalesPerOctave'),
    scalesValue: document.getElementById('scalesValue'),
    sigmaInput: document.getElementById('initialSigma'),
    sigmaValue: document.getElementById('sigmaValue'),
    processBtn: document.getElementById('processBtn'),
    statusMsg: document.getElementById('statusMessage'),
    
    mainCanvas: document.getElementById('mainCanvas'),
    overlayCanvas: document.getElementById('overlayCanvas'),
    
    gaussianView: document.getElementById('gaussian-view'),
    dogView: document.getElementById('dog-view'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    
    chartCanvas: document.getElementById('responseChart')
};

// Event Listeners
els.imageUpload.addEventListener('change', handleImageUpload);
els.scalesInput.addEventListener('input', (e) => els.scalesValue.textContent = e.target.value);
els.sigmaInput.addEventListener('input', (e) => els.sigmaValue.textContent = e.target.value);
els.processBtn.addEventListener('click', generateScaleSpace);

els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active tab
        els.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update view
        document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

els.mainCanvas.addEventListener('click', handleCanvasClick);

// Initialization
initChart();
loadDefaultImage();

function loadDefaultImage() {
    els.fileName.textContent = "default_checkerboard.png";
    els.statusMsg.textContent = "Loading default image...";
    els.processBtn.disabled = true;

    const w = 400;
    const h = 400;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    // Draw checkerboard
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111'; // Not perfectly black so edges aren't strictly 0
    for(let i=0; i<8; i++){
        for(let j=0; j<8; j++){
            if((i+j)%2 === 1){
                ctx.fillRect(i*50, j*50, 50, 50);
            }
        }
    }

    state.width = w;
    state.height = h;
    
    const imageData = ctx.getImageData(0, 0, w, h);
    state.sourceImage = convertToGrayscale(imageData).data;
    
    // Render to main view
    renderToCanvas(els.mainCanvas, state.sourceImage, w, h);
    
    // Setup overlay canvas
    els.overlayCanvas.width = w;
    els.overlayCanvas.height = h;
    els.overlayCanvas.style.width = els.mainCanvas.clientWidth + 'px';
    els.overlayCanvas.style.height = els.mainCanvas.clientHeight + 'px';
    
    els.statusMsg.textContent = "Ready.";
    els.processBtn.disabled = false;
    
    // Automatically generate with default settings
    generateScaleSpace();
}

/**
 * Image Loading
 */
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    els.fileName.textContent = file.name;
    els.statusMsg.textContent = "Loading image...";
    els.processBtn.disabled = true;
    
    const img = new Image();
    img.onload = () => {
        // We need to scale down the image if it's too large to keep processing real-time
        const MAX_DIM = 400;
        let w = img.width;
        let h = img.height;
        
        if (w > MAX_DIM || h > MAX_DIM) {
            const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.floor(w * ratio);
            h = Math.floor(h * ratio);
        }
        
        state.width = w;
        state.height = h;
        
        // Draw to hidden canvas to get pixel data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        
        const imageData = ctx.getImageData(0, 0, w, h);
        state.sourceImage = convertToGrayscale(imageData).data;
        
        // Render to main view
        renderToCanvas(els.mainCanvas, state.sourceImage, w, h);
        
        // Setup overlay canvas
        els.overlayCanvas.width = w;
        els.overlayCanvas.height = h;
        els.overlayCanvas.style.width = els.mainCanvas.clientWidth + 'px';
        els.overlayCanvas.style.height = els.mainCanvas.clientHeight + 'px';
        
        els.statusMsg.textContent = "Ready.";
        els.processBtn.disabled = false;
        
        // Automatically generate with default settings
        generateScaleSpace();
    };
    img.src = URL.createObjectURL(file);
}

function renderToCanvas(canvas, floatMap, width, height) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = floatToImageData(floatMap, width, height);
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Core Logic: Generate Pyramids
 */
function generateScaleSpace() {
    if (!state.sourceImage) return;
    
    els.statusMsg.textContent = "Generating scale space... (this may take a moment)";
    els.processBtn.disabled = true;
    
    // Free UI thread to allow status message to render
    setTimeout(() => {
        try {
            state.scalesPerOctave = parseInt(els.scalesInput.value);
            state.initialSigma = parseFloat(els.sigmaInput.value);
            
            buildPyramids();
            renderGrids();
            
            els.statusMsg.textContent = "Processing complete. Click the image to analyze.";
            els.processBtn.disabled = false;
        } catch (error) {
            console.error(error);
            els.statusMsg.textContent = "Error generating scale space.";
            els.processBtn.disabled = false;
        }
    }, 50);
}

function buildPyramids() {
    const s = state.scalesPerOctave;
    const k = Math.pow(2.0, 1.0 / s);
    const sigma0 = state.initialSigma;
    
    // We need s + 3 images per octave to get s + 2 DoG images (which lets us find extrema in s scales)
    const imagesPerOctave = s + 3;
    
    state.gaussianPyramid = [];
    state.dogPyramid = [];
    state.dogPyramidRaw = []; // Keep raw values for charting
    state.sigmas = [];
    
    // Precompute sigmas for the lowest octave relative to the pixel grid
    state.sigmas = [];
    for (let i = 0; i < imagesPerOctave; i++) {
        state.sigmas.push(sigma0 * Math.pow(k, i));
    }

    let currentImage = new Float32Array(state.sourceImage); // Copy
    let cw = state.width;
    let ch = state.height;
    
    // Assume input image is already pre-blurred to sigma=0.5 (standard practice is to double and blur to 1.6, we skip doubling for simplicity)
    const assumedBaseSigma = 0.5;
    if (sigma0 > assumedBaseSigma) {
        const blurNeeded = Math.sqrt(sigma0*sigma0 - assumedBaseSigma*assumedBaseSigma);
        currentImage = gaussianBlur(currentImage, cw, ch, blurNeeded);
    }
    
    for (let o = 0; o < state.numOctaves; o++) {
        const octaveImages = [currentImage];
        const octaveDogs = [];
        const octaveDogsRaw = [];
        
        let prevSigma = sigma0; // Effective sigma of currentImage in this octave
        
        for (let i = 1; i < imagesPerOctave; i++) {
            const currentSigma = state.sigmas[i];
            // To get from prevSigma to currentSigma efficiently:
            // sigma_diff^2 = currentSigma^2 - prevSigma^2
            const blurSigma = Math.sqrt(currentSigma*currentSigma - prevSigma*prevSigma);
            
            const nextImage = gaussianBlur(octaveImages[i-1], cw, ch, blurSigma);
            octaveImages.push(nextImage);
            
            // Generate DoG
            const dogRes = subtractImages(octaveImages[i-1], nextImage, cw, ch);
            octaveDogsRaw.push(dogRes.rawValues);
            octaveDogs.push(dogRes.displayData);
            
            prevSigma = currentSigma;
        }
        
        state.gaussianPyramid.push({ data: octaveImages, width: cw, height: ch });
        state.dogPyramid.push({ data: octaveDogs, width: cw, height: ch });
        state.dogPyramidRaw.push({ data: octaveDogsRaw, width: cw, height: ch });
        
        // Prepare for next octave: Downsample the image at index 's' (sigma = sigma0 * 2)
        const baseForNext = octaveImages[s];
        
        const nextW = Math.max(1, Math.floor(cw / 2));
        const nextH = Math.max(1, Math.floor(ch / 2));
        const downsampled = new Float32Array(nextW * nextH);
        for(let yy=0; yy < nextH; yy++){
            for(let xx=0; xx < nextW; xx++){
                downsampled[yy*nextW + xx] = baseForNext[(yy*2)*cw + (xx*2)];
            }
        }
        
        currentImage = downsampled;
        cw = nextW;
        ch = nextH;
    }
}

/**
 * UI Rendering
 */
function renderGrids() {
    generateGridView(els.gaussianView, state.gaussianPyramid, "Gaussian Image");
    generateGridView(els.dogView, state.dogPyramid, "DoG");
}

function generateGridView(container, pyramidData, labelPrefix) {
    container.innerHTML = ''; // Clear
    
    pyramidData.forEach((octave, oIdx) => {
        const row = document.createElement('div');
        row.className = 'octave-row';
        
        const header = document.createElement('div');
        header.className = 'octave-header';
        header.textContent = `Octave ${oIdx} (${octave.width}x${octave.height})`;
        row.appendChild(header);
        
        const grid = document.createElement('div');
        grid.className = 'image-grid';
        
        octave.data.forEach((imgMap, iIdx) => {
            const item = document.createElement('div');
            item.className = 'grid-item';
            
            const canvas = document.createElement('canvas');
            renderToCanvas(canvas, imgMap, octave.width, octave.height);
            // Fix visual size across octaves
            canvas.style.width = '120px';
            canvas.style.height = (120 * (octave.height / octave.width)) + 'px';
            
            const label = document.createElement('div');
            label.className = 'grid-label';
            
            // Format label nicely
            let sigmaEffective;
            if (labelPrefix === 'DoG') {
                sigmaEffective = state.sigmas[iIdx] * Math.pow(2, oIdx);
                label.textContent = `Δσ ~ ${sigmaEffective.toFixed(2)}`;
            } else {
                sigmaEffective = state.sigmas[iIdx] * Math.pow(2, oIdx);
                label.textContent = `σ = ${sigmaEffective.toFixed(2)}`;
            }
            
            item.appendChild(canvas);
            item.appendChild(label);
            grid.appendChild(item);
        });
        
        row.appendChild(grid);
        container.appendChild(row);
    });
}

/**
 * Interaction Details
 */
function handleCanvasClick(e) {
    if (!state.dogPyramidRaw || state.dogPyramidRaw.length === 0) return;
    
    // Get click coords relative to the visual canvas 
    const rect = els.mainCanvas.getBoundingClientRect();
    const scaleX = els.mainCanvas.width / rect.width;
    const scaleY = els.mainCanvas.height / rect.height;
    
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    
    const px = Math.floor(displayX * scaleX);
    const py = Math.floor(displayY * scaleY);
    
    const chartData = getChartData(px, py);
    
    // Find characteristic scales (local maxima in scale space)
    const characteristicScales = [];
    if (chartData.values.length > 0) {
        let maxVal = Math.max(...chartData.values);
        let threshold = maxVal * 0.5; // Only consider peaks that are at least 50% of the global max
        
        for (let i = 1; i < chartData.values.length - 1; i++) {
            if (chartData.values[i] > chartData.values[i-1] && 
                chartData.values[i] > chartData.values[i+1] && 
                chartData.values[i] > threshold) {
                characteristicScales.push(chartData.sigmas[i]);
            }
        }
        
        // If no distinct local maxima, but we have a peak at the edges, or just want a fallback
        if (characteristicScales.length === 0) {
            const maxIdx = chartData.values.indexOf(maxVal);
            if (maxIdx >= 0) {
                characteristicScales.push(chartData.sigmas[maxIdx]);
            }
        }
    }
    
    drawOverlayMarker(px, py, characteristicScales);
    plotChartWithData(chartData.labels, chartData.values);
}

function drawOverlayMarker(x, y, characteristicScales = []) {
    const ctx = els.overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
    
    // Draw circles for characteristic scales
    characteristicScales.forEach(scale => {
        ctx.strokeStyle = '#58a6ff'; // Accent color
        ctx.lineWidth = 2;
        ctx.beginPath();
        // The scale sigma visually corresponds to a blob of radius roughly sqrt(2) * sigma
        const radius = Math.SQRT2 * scale;
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(88, 166, 255, 0.15)';
        ctx.fill();
    });
    
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.lineTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.lineTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
}

/**
 * Charting 
 */
function initChart() {
    const ctx = els.chartCanvas.getContext('2d');
    
    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.family = 'Inter';
    
    state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], /* Computed Scales */
            datasets: [{
                label: 'DoG Magnitude magnitude(L(σ) - L)',
                data: [],
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88, 166, 255, 0.2)',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#e6edf3',
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `Response: ${context.parsed.y.toFixed(4)}`
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Scale (σ)'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Abs Difference'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        }
    });
}

function getChartData(px, py) {
    const labels = [];
    const values = [];
    const sigmas = [];
    
    // Gather all data points across octaves
    for (let o = 0; o < state.dogPyramidRaw.length; o++) {
        const octaveData = state.dogPyramidRaw[o];
        const octW = octaveData.width;
        
        // Find corresponding coordinate in this octave
        // Coordinates halve every octave
        const ox = Math.floor(px / Math.pow(2, o));
        const oy = Math.floor(py / Math.pow(2, o));
        
        if (ox < 0 || ox >= octaveData.width || oy < 0 || oy >= octaveData.height) {
            continue; // Out of bounds for this downsampled octave
        }
        
        const idx = oy * octW + ox;
        
        for (let i = 0; i < octaveData.data.length; i++) {
            const rawVal = octaveData.data[i][idx];
            // Get absolute magnitude of edge/blob response
            values.push(Math.abs(rawVal));
            
            const effSigma = state.sigmas[i] * Math.pow(2, o);
            sigmas.push(effSigma);
            labels.push(effSigma.toFixed(2));
        }
    }
    
    return { labels, values, sigmas };
}

function plotChartWithData(labels, values) {
    state.chartInstance.data.labels = labels;
    state.chartInstance.data.datasets[0].data = values;
    state.chartInstance.update();
}
