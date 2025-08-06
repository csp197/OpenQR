from PIL import Image

# Input/output paths
source = "assets/openqr_icon.png"
target = "assets/openqr_icon.ico"

# Convert and save
img = Image.open(source)
img.save(target, format='ICO', sizes=[(256, 256)])
print(f"✅ Created {target}")
