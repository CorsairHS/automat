#!/bin/bash
# Jednorazowa konfiguracja WLASNEGO certyfikatu do podpisywania aplikacji na Maca.
#
# Po co: auto-aktualizacja na macOS (Squirrel/ShipIt) przyjmuje nowa wersje tylko wtedy,
# gdy jest podpisana "tym samym" podpisem co zainstalowana. Podpis ad-hoc (codesign
# --sign -) identyfikuje aplikacje wylacznie skrotem plikow (cdhash), wiec KAZDA nowa
# wersja go nie spelnia i aktualizacja zawsze konczy sie bledem "Code signature ... did not
# pass validation". Staly certyfikat sprawia, ze wymaganie brzmi "identyfikator
# pl.partnertax.automat + ten certyfikat" - spelnia je kazda kolejna wersja.
#
# Co robi:
#   - generuje certyfikat self-signed z rozszerzeniem Code Signing (wazny 20 lat),
#   - zapisuje go w OSOBNYM pęku kluczy ~/Library/Keychains/partnertax-signing.keychain-db
#     (z losowym haslem w ~/.partnertax-signing/keychain-password), zeby build nie
#     wymagal hasla do glownego pęku i nie pokazywal okienek "codesign chce uzyc klucza",
#   - zostawia kopie zapasowa certyfikatu z kluczem w ~/.partnertax-signing/.
#
# WAZNE: katalog ~/.partnertax-signing to jedyna kopia klucza. Jesli zginie, kolejna wersja
# nie zaktualizuje sie automatycznie u klientow (trzeba bedzie raz zainstalowac recznie).
# Zrob jego kopie zapasowa (np. zaszyfrowany pendrive / menedzer hasel). NIE wrzucaj go do
# repozytorium.
set -euo pipefail

IDENTITY="PartnerTax Automat Signing"
SIGN_DIR="$HOME/.partnertax-signing"
KEYCHAIN="$HOME/Library/Keychains/partnertax-signing.keychain-db"
OPENSSL="${OPENSSL:-openssl}"

if [ -f "$SIGN_DIR/cert.p12" ]; then
  echo "Certyfikat juz istnieje w $SIGN_DIR - nic nie robie."
  echo "(Nowy certyfikat zepsulby auto-aktualizacje u klientow - patrz komentarz w skrypcie.)"
  exit 0
fi

mkdir -p "$SIGN_DIR"
chmod 700 "$SIGN_DIR"
cd "$SIGN_DIR"

KEYCHAIN_PASSWORD="$("$OPENSSL" rand -hex 24)"
P12_PASSWORD="$("$OPENSSL" rand -hex 24)"

cat > cert.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $IDENTITY
O = PartnerTax
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -sha256 -days 7300 -nodes \
  -keyout key.pem -out cert.pem -config cert.cnf
# -legacy: macOS (security import) nie czyta p12 z domyslnymi algorytmami OpenSSL 3.
"$OPENSSL" pkcs12 -export -legacy -inkey key.pem -in cert.pem -name "$IDENTITY" \
  -out cert.p12 -passout "pass:$P12_PASSWORD"
rm -f key.pem

printf '%s' "$KEYCHAIN_PASSWORD" > keychain-password
printf '%s' "$P12_PASSWORD" > p12-password
chmod 600 keychain-password p12-password cert.p12

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"   # bez automatycznego blokowania
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import cert.p12 -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# Dopisz pęk do listy wyszukiwania (codesign szuka tozsamosci tylko na tej liscie).
EXISTING=$(security list-keychains -d user | sed 's/^ *"//; s/"$//')
security list-keychains -d user -s "$KEYCHAIN" $EXISTING

echo
echo "Gotowe. Certyfikat \"$IDENTITY\" jest w $KEYCHAIN."
echo "Kopia zapasowa: $SIGN_DIR (zrob jej kopie poza tym komputerem!)."
