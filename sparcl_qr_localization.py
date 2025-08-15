import numpy as np
import cv2

def camera_matrix(fx, fy, width, height):
    cx = width / 2
    cy = height / 2

    K = np.matrix(
        [
            [fx, 0.0, cx],
            [0.0, fy, cy],
            [0.0, 0.0, 1.0],
        ]
    )

    return K


# This decomposes the homogrpahy matrix
# Takes two inputs
# A - intrinsic camera matrix
# H - homography between two 2D points
def decompose_homography(K, H):
    H = np.transpose(H)
    h1 = H[0]
    h2 = H[1]
    h3 = H[2]

    Kinv = np.linalg.inv(K)

    L = 1 / np.linalg.norm(np.dot(Kinv, h1))

    r1 = L * np.dot(Kinv, h1)
    r2 = L * np.dot(Kinv, h2)
    r3 = np.cross(r1, r2)

    T = L * np.dot(Kinv, h3)

    R = np.array([[r1], [r2], [r3]])
    R = np.reshape(R, (3, 3))
    U, S, V = np.linalg.svd(R, full_matrices=True)

    U = np.matrix(U)
    V = np.matrix(V)
    R = U * V

    return (R, T)


qrImage = cv2.imread('C:\\Users\\gsoros\\OneDrive - Nokia\\Esoptron\\OfficeDigitalTwin\\QR code tools\\qr-geopose-gomboc.png')
camImage = cv2.imread('C:\\Users\\gsoros\\OneDrive - Nokia\\Esoptron\\OfficeDigitalTwin\\QR code tools\\your_photo.jpeg')

#u0=443 v0=960 x=1342.505450963974 ay=1342.7386093139648 gamma=0 for viewport {width=886,height=1920,x=0,y=0}
camWidth = 886
camHeight = 1920
fx = 1342.505450963974
fy = 1342.7386093139648
K = camera_matrix(fx, fy, camWidth, camHeight)


camCornerPts = np.array([
    [249,713], # top left
    [786,883], # top right
    [613,1452], # bottom right
    [41,1249] # bottom left
])
print(camCornerPts)
vizImageJs = cv2.polylines(camImage, [camCornerPts], True, (0,255,255), 1)
cv2.imshow("JS detected code", vizImageJs)

# normalized
camCornerPtsNorm = np.copy(camCornerPts)
for i in range(4):
    camCornerPtsNorm[i][0] *= 1/camWidth
    camCornerPtsNorm[i][1] *= 1/camHeight
print(camCornerPtsNorm)

kCodePrintWidth = qrImage.shape[0] # 0.13 # meters

qrCornerPtsNorm = kCodePrintWidth * np.array([
    [0, 0], # top left
    [1, 0], # top right
    [1, 1], # bottom right
    [0, 1] # bottom left
])


# homography from 2d points to image points
homography1, _ = cv2.findHomography(
    np.array(qrCornerPtsNorm).astype(float),
    np.array(camCornerPts).astype(float),
)
#homography1, _ = cv2.findHomography(
#    np.array(pts_image).astype(float),
#    np.array(pts_code).astype(float),
#)
print("homography CV")
print(homography1)

'''
# homography from image to centered 2d points
# show how a 2d plane can be stabilized from multiple view points
display_homography, _ = cv2.findHomography(
    np.array(pts_image).astype(float),
    np.array(pts_code).astype(float) + (w // 2, h // 2),
)
'''

homography2 = np.array([
    [4.21591857072628, 1.8737415869894576, -2579.2052944909883],
    [-1.2163086142118287, 11.975961739931835, -9557.00459286779],
    [0.00025571658294832705, 0.0015456287419880115, 1.0]
])
print("homography JS")
print(homography2)



homography3 = np.linalg.inv(homography2)
print("homography JS inverse")
print(homography3)

# extract rotation and translation from homography
(R, T) = decompose_homography(K, homography2)


print()
print("R and T:")
print(R)
print(T)
print()
#if R is None or T is None:
#    return None


# Warp source image to destination based on homography
warpedQrImage = cv2.warpPerspective(qrImage, homography1, (camWidth, camHeight))

# Display images
cv2.imshow("Source Image", qrImage)
cv2.imshow("Warped Source Image", warpedQrImage)





qcd = cv2.QRCodeDetector()
retval, decoded_info, points, straight_qrcode = qcd.detectAndDecodeMulti(camImage)
print(points)
vizImageCv = cv2.polylines(camImage, points.astype(int), True, (255, 0, 0), 1)
cv2.imshow("CV detected code", vizImageJs)
cv2.waitKey(0)
'''

# convert physical points to pixel points
pixels = np.array([[425, 14], [298, 13], [427, 128], [424, 654], [292,661]])  # for room_2.png
points = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 5.98], [1.0, 6.02]])

H, status = cv2.findHomography(points, pixels)
print(H)

testX = 1.0
testY = 1.0
point_location = np.array([testX, testY, 1.0]) # last 1 is homogenous coordinate
w = np.matmul(H, point_location)
#print(w)
print(w[0:2]/w[2])

'''
