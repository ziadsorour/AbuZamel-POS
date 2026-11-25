import sys
try:
    from PIL import Image
    img = Image.open('C:\\Users\\sorour\\.gemini\\antigravity\\scratch\\abuzamel_pos\\app-icon.png')
    # Save as multi-size ICO
    img.save('C:\\Users\\sorour\\.gemini\\antigravity\\scratch\\abuzamel_pos\\icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    print("Icon converted.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
