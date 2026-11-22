# Sosyal tarama giriş görevlerini kaydeder: NichevoSocialLogin-x ve NichevoSocialLogin-instagram.
# Sunucu (NichevoApi) S4U ile pencere olmayan bir oturumda çalışır; uygulamadaki "Giriş yap" düğmesi bu görevi
# `schtasks /run` ile tetikler ve görev, SENİN masaüstü oturumunda (Interactive) görünür bir Chrome penceresi açar.
# Tetikleyici yok: yalnızca isteyince çalışır. Yönetici yetkisi gerekmez.
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $dir
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\social-login.mjs'
foreach ($p in @('x', 'instagram')) {
  $action    = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" $p" -WorkingDirectory $root
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "NichevoSocialLogin-$p" -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  Write-Output "kayitli: NichevoSocialLogin-$p"
}
