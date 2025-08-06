from datetime import datetime

version = "1.0.0"
company_name = "CSP"
file_description = "OpenQR - QR Code Listener and Scanner"
internal_name = "OpenQR"
legal_copyright = f"Copyright © {datetime.year} CSP"
original_filename = "OpenQR.exe"
product_name = "OpenQR"
product_version = version

content = f"""\
# UTF-8
#
# For more details: https://pyinstaller.org/en/stable/spec-files.html#using-version-files-on-windows

VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=({version.replace('.', ',')}, 0),
    prodvers=({product_version.replace('.', ',')}, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x4,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
    ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904B0',
        [
          StringStruct('CompanyName', '{company_name}'),
          StringStruct('FileDescription', '{file_description}'),
          StringStruct('FileVersion', '{version}'),
          StringStruct('InternalName', '{internal_name}'),
          StringStruct('LegalCopyright', '{legal_copyright}'),
          StringStruct('OriginalFilename', '{original_filename}'),
          StringStruct('ProductName', '{product_name}'),
          StringStruct('ProductVersion', '{product_version}')
        ])
      ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""

with open("version.txt", "w", encoding="utf-8") as f:
    f.write(content)

print("✅ Generated version.txt")
