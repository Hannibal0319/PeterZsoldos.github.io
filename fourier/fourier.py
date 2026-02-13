import matplotlib
matplotlib.use("TkAgg")   # MUST be before pyplot

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider

# ----- Create test image -----
N = 128
x = np.linspace(-1, 1, N)
y = np.linspace(-1, 1, N)
X, Y = np.meshgrid(x, y)

# phantom shepp-logan parameters: (A, a, b, x0, y0, phi)
ellipses = [
    (1, .69, .92, 0, 0, 0),
    (-.8, .6624, .8740, 0, -.0184, 0),
    (-.2, .1100, .3100, .22, 0, -18),
    (-.2, .1600, .4100, -.22, 0, 18),
    (.1, .2100, .2500, 0, .35, 0),
    (.1, .0460, .0460, 0, .1, 0),
    (.1, .0460, .0460, 0, -.1, 0),
    (.1, .0460, .0230, -.08, -.605, 0),
    (.1, .0230, .0230, 0.06, -.605, 0),
    (.1, .0230, .0460, 0.06, -.605, 90)
]
image = np.zeros((N, N))
for A, a, b, x0, y0, phi in ellipses:
    phi = np.deg2rad(phi)
    cos_p, sin_p = np.cos(phi), np.sin(phi)
    x_rot = cos_p * (X - x0) + sin_p * (Y - y0)
    y_rot = -sin_p * (X - x0) + cos_p * (Y - y0)
    mask = (x_rot / a) ** 2 + (y_rot / b) ** 2 <= 1
    image[mask] += A

F2 = np.fft.fftshift(np.fft.fft2(image))
freq = np.linspace(-N//2, N//2 - 1, N)
center = N // 2

# ----- Projection + Reconstruction -----
def compute(theta_deg):
    theta = np.deg2rad(theta_deg)

    Xr = X * np.cos(theta) + Y * np.sin(theta)
    Yr = -X * np.sin(theta) + Y * np.cos(theta)

    Xi = ((Xr + 1) / 2 * (N - 1)).astype(int)
    Yi = ((Yr + 1) / 2 * (N - 1)).astype(int)

    valid = (Xi >= 0) & (Xi < N) & (Yi >= 0) & (Yi < N)
    rotated = np.zeros_like(image)
    rotated[valid] = image[Yi[valid], Xi[valid]]

    projection = np.sum(rotated, axis=0)
    F1 = np.fft.fftshift(np.fft.fft(projection))

    slice_2d = np.zeros_like(F2, dtype=complex)
    for i, f in enumerate(freq):
        kx = int(center + f * np.cos(theta))
        ky = int(center + f * np.sin(theta))
        if 0 <= kx < N and 0 <= ky < N:
            slice_2d[ky, kx] = F2[ky, kx]

    recon = np.real(np.fft.ifft2(np.fft.ifftshift(slice_2d)))

    return projection, F1, recon


# ----- Setup Figure -----
theta0 = 0
projection, F1, recon = compute(theta0)
sinogram_full = np.zeros((N, 180))
for i, t in enumerate(np.linspace(0, 180, 180, endpoint=False)):
    sinogram_full[:, i], _, _ = compute(t)
sinogram_accum = np.zeros_like(sinogram_full)
sinogram_vmin = sinogram_full.min()
sinogram_vmax = sinogram_full.max()

# accumulate slices for backprojection in Fourier domain
accum_slice_2d = np.zeros_like(F2, dtype=complex)

fig, ax = plt.subplots(2, 3, figsize=(14, 7.2))

#no margin on top row, more space on bottom for slider
plt.subplots_adjust(top=0.95)
# Original
ax[0, 0].set_title("Original Image")
im0 = ax[0, 0].imshow(image, cmap='gray')
ax[0, 0].axis("off")
orig_line, = ax[0, 0].plot([], [], color='red', lw=1.5)
# add 3 more lines to show the projection angle 9

# Projection
ax[0, 1].set_title("Projection")
line_proj, = ax[0, 1].plot(projection)

# 1D Fourier
ax[1, 1].set_title("1D Fourier of Projection")
line_f1, = ax[1, 1].plot(np.abs(F1))

# 2D Fourier
ax[1, 0].set_title("2D Fourier + Slice")
imF = ax[1, 0].imshow(np.log(np.abs(F2)+1e-3), cmap='gray')
slice_line, = ax[1, 0].plot([], [])

# Reconstruction
ax[1, 2].set_title("Accumulated Reconstruction")
imRecon = ax[1, 2].imshow(recon, cmap='gray')
ax[1, 2].axis("off")

ax[0, 2].set_title("Accumulated Sinogram")
imSinogram = ax[0, 2].imshow(
    sinogram_accum,
    cmap='gray',
    vmin=sinogram_vmin,
    vmax=sinogram_vmax,
    aspect='auto'
)
ax[0, 2].axis("off")



# ----- Slider -----
ax_slider = plt.axes([0.25, 0.02, 0.5, 0.03])
slider = Slider(ax_slider, "Angle (degrees)", 0, 179, valinit=theta0, valstep=1)

def line_coords(theta_deg):
    """Return endpoints for a line through the image center at angle theta_deg."""
    theta = np.deg2rad(theta_deg)
    dx = (N / 2) * np.cos(theta)
    dy = (N / 2) * np.sin(theta)
    x0, y0 = center - dx, center - dy
    x1, y1 = center + dx, center + dy
    return (x0, x1), (y0, y1)


def add_slice(theta_deg):
    """Insert a Fourier slice for the given angle into the accumulated spectrum."""
    theta = np.deg2rad(theta_deg)
    xs = center + freq * np.cos(theta)
    ys = center + freq * np.sin(theta)
    for x, y in zip(xs, ys):
        kx = int(round(x))
        ky = int(round(y))
        if 0 <= kx < N and 0 <= ky < N:
            accum_slice_2d[ky, kx] = F2[ky, kx]


def rebuild_accum(theta_deg):
    """Rebuild accumulated slices from 0..theta_deg (integer steps)."""
    accum_slice_2d.fill(0)
    theta_int = int(np.round(theta_deg))
    for t in range(theta_int + 1):  # inclusive
        add_slice(t)


def rebuild_sinogram(theta_deg):
    """Rebuild sinogram up to theta_deg using precomputed projections."""
    sinogram_accum.fill(0)
    theta_int = int(np.round(theta_deg))
    cols = min(theta_int + 1, sinogram_accum.shape[1])
    if cols > 0:
        sinogram_accum[:, :cols] = sinogram_full[:, :cols]

def update(val):
    theta = slider.val
    projection, F1, recon = compute(theta)

    line_proj.set_ydata(projection)
    line_f1.set_ydata(np.abs(F1))
    imRecon.set_data(recon)

    # update slice line
    xs = center + freq * np.cos(np.deg2rad(theta))
    ys = center + freq * np.sin(np.deg2rad(theta))
    slice_line.set_data(xs, ys)

    # update overlay on original image
    x_line, y_line = line_coords(theta)
    orig_line.set_data(x_line, y_line)

    # accumulate reconstruction up to current angle (integer degrees)
    rebuild_accum(theta)
    accum_recon = np.real(np.fft.ifft2(np.fft.ifftshift(accum_slice_2d)))
    imRecon.set_data(accum_recon)

    rebuild_sinogram(theta)
    imSinogram.set_data(sinogram_accum)

    fig.canvas.draw_idle()

slider.on_changed(update)

# set initial line positions
x_line0, y_line0 = line_coords(theta0)
orig_line.set_data(x_line0, y_line0)
xs0 = center + freq * np.cos(np.deg2rad(theta0))
ys0 = center + freq * np.sin(np.deg2rad(theta0))
slice_line.set_data(xs0, ys0)

# seed accumulation with initial angle
rebuild_accum(theta0)
imRecon.set_data(np.real(np.fft.ifft2(np.fft.ifftshift(accum_slice_2d))))
rebuild_sinogram(theta0)
imSinogram.set_data(sinogram_accum)

plt.show()
