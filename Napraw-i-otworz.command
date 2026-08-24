#!/bin/bash
# Ten plik odbezpiecza "PartnerTax Automat.app" pobrana spoza App Store
# (aplikacja nie ma platnego podpisu Apple Developer ID, wiec system
# domyslnie ja blokuje przy pierwszym uruchomieniu).
#
# Instrukcja dla odbiorcy:
# 1. Przeciagnij "PartnerTax Automat.app" do folderu Programy (Applications).
# 2. Kliknij prawym przyciskiem na ten plik (Napraw-i-otworz.command) i wybierz "Otworz".
#    Jesli system pokaze ostrzezenie o nieznanym deweloperze, potwierdz "Otworz".
# 3. Poczekaj na komunikat "Gotowe" w oknie Terminala.
# 4. Odpal appke normalnie z Programow.

APP="/Applications/PartnerTax Automat.app"

if [ ! -d "$APP" ]; then
  echo "Nie znaleziono aplikacji w $APP"
  echo "Najpierw przeciagnij 'PartnerTax Automat.app' do folderu Programy, a potem uruchom ten plik ponownie."
  read -p "Nacisnij Enter, aby zamknac to okno..."
  exit 1
fi

echo "Usuwam blokade systemowa..."
xattr -cr "$APP"

echo "Podpisuje aplikacje lokalnie..."
codesign --force --deep --sign - "$APP"

echo ""
echo "Gotowe! Mozesz teraz otworzyc 'PartnerTax Automat' z Programow."
read -p "Nacisnij Enter, aby zamknac to okno..."
