# נכסי חנות מוכנים

התיקייה `store-assets` כוללת את כל הנכסים הגרפיים הראשוניים לפרסום ב-Chrome Web Store וב-Microsoft Edge Add-ons.

## צילומי מסך

כל צילומי המסך הם בגודל `1280x800`:

- `screenshot-01-reader-1280x800.png`
- `screenshot-02-rtl-book-1280x800.png`
- `screenshot-03-annotations-1280x800.png`
- `screenshot-04-search-bookmarks-1280x800.png`
- `screenshot-05-export-print-1280x800.png`

## תמונות קידום

- `promo-small-440x280.png`
- `marquee-1400x560.png`

## טקסטים שיווקיים

הטקסטים המקוצרים נמצאים ב-`STORE_MARKETING_COPY_HE.md`.

## יצירה מחדש

כדי ליצור מחדש את כל התמונות:

```powershell
powershell -ExecutionPolicy Bypass -File tools\generate-store-assets.ps1
```
