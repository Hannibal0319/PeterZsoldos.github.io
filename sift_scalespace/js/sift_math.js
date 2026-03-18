/**
 * Core mathematical and image processing functions for SIFT Scale Space generation.
 * Operates on single-channel (grayscale) Float32Arrays for precision.
 */

// Convert RGBA ImageData to a Float32Array (0.0 to 1.0) grayscale
function convertToGrayscale(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const gray = new Float32Array(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
        // Standard luminosity weights
        const r = data[i] / 255.0;
        const g = data[i+1] / 255.0;
        const b = data[i+2] / 255.0;
        const index = i / 4;
        gray[index] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return { data: gray, width, height };
}

// Convert Float32Array grayscale back to ImageData for canvas rendering
function floatToImageData(grayMap, width, height) {
    const imageData = new ImageData(width, height);
    const data = imageData.data;
    
    for (let i = 0; i < grayMap.length; i++) {
        const val = Math.max(0, Math.min(255, Math.floor(grayMap[i] * 255.0)));
        const idx = i * 4;
        data[idx] = val;     // R
        data[idx+1] = val;   // G
        data[idx+2] = val;   // B
        data[idx+3] = 255;   // Alpha
    }
    return imageData;
}

// Generates a 1D Gaussian kernel
function getGaussianKernel(sigma) {
    if (sigma <= 0.0) return [1.0];
    
    // Rule of thumb: radius is ~ 3 * sigma
    const radius = Math.ceil(3.0 * sigma);
    const size = 2 * radius + 1;
    const kernel = new Float32Array(size);
    
    const sigma2 = sigma * sigma;
    let sum = 0.0;
    
    for (let i = -radius; i <= radius; i++) {
        const val = Math.exp(-(i * i) / (2.0 * sigma2));
        kernel[i + radius] = val;
        sum += val;
    }
    
    // Normalize so it sums to 1
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    
    return kernel;
}

// Performs a 1D convolution along rows or columns
function convolve1D(input, width, height, kernel, isHorizontal) {
    const output = new Float32Array(width * height);
    const radius = Math.floor(kernel.length / 2);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0.0;
            
            for (let i = -radius; i <= radius; i++) {
                const kVal = kernel[i + radius];
                
                let nx, ny;
                if (isHorizontal) {
                    nx = x + i;
                    ny = y;
                    // Clamp to edge
                    if (nx < 0) nx = 0;
                    if (nx >= width) nx = width - 1;
                } else {
                    nx = x;
                    ny = y + i;
                    // Clamp to edge
                    if (ny < 0) ny = 0;
                    if (ny >= height) ny = height - 1;
                }
                
                sum += kVal * input[ny * width + nx];
            }
            output[y * width + x] = sum;
        }
    }
    return output;
}

// 2-Pass Separable Gaussian Blur
function gaussianBlur(inputMap, width, height, sigma) {
    if (sigma <= 0) {
        return new Float32Array(inputMap); // Copy
    }
    
    const kernel = getGaussianKernel(sigma);
    const horizontalPass = convolve1D(inputMap, width, height, kernel, true);
    const verticalPass = convolve1D(horizontalPass, width, height, kernel, false);
    
    return verticalPass;
}

// Downsample image by factor of 2 (taking every other pixel)
function downsampleInfo(imgMap, width, height) {
    const newWidth = Math.max(1, Math.floor(width / 2));
    const newHeight = Math.max(1, Math.floor(height / 2));
    const output = new Float32Array(newWidth * newHeight);
    
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            // Nearest neighbor sample for SIFT octave transition
            output[y * newWidth + x] = imgMap[(y * 2) * width + (x * 2)];
        }
    }
    
    return { data: output, width: newWidth, height: newHeight };
}

// Subtract image2 from image1 (for DoG)
// Normalizes the output visually to 0-1 for display by scaling up the small differences
function subtractImages(img1, img2, width, height) {
    const output = new Float32Array(width * height);
    const displayMap = new Float32Array(width * height);
    
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < width * height; i++) {
        // DoG = L(x, y, k*sigma) - L(x, y, sigma)
        // Note: SIFT theory usually does next scale - current scale
        const diff = img2[i] - img1[i];
        output[i] = diff;
        
        if (diff < min) min = diff;
        if (diff > max) max = diff;
    }
    
    // For visualization, map the differences to 0..1 centered around 0.5 (gray)
    // DoG values are usually close to 0, so we amplify them for visual clarity
    const amplify = 10.0; 
    
    for (let i = 0; i < width * height; i++) {
        // Center 0 diff at 0.5
        let vis = 0.5 + (output[i] * amplify);
        vis = Math.max(0, Math.min(1.0, vis)); // Clamp
        displayMap[i] = vis;
    }
    
    return { 
        rawValues: output,     // Keep raw float values for chart plotting
        displayData: displayMap // Gray 0-1 mapped values for canvas Render
    };
}
