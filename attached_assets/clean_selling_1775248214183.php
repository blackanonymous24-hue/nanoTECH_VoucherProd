<?php
session_start();
require("../lib/routeros_api.class.php");
require("../lib/formatbytesbites.php");
require("../lib/crypt.php");

$API = new RouterosAPI();
$API->debug = false;

$iphost = $_SESSION["iphost"];
$userhost = $_SESSION["userhost"];
$passwdhost = $_SESSION["passwdhost"];

if ($API->connect($iphost, $userhost, decrypt($passwdhost))) {

    // Obtenir la date actuelle
    $now = new DateTime();
    $limit = $now->modify("-2 months"); // 2 mois avant aujourd’hui

    // Récupérer tous les scripts marqués mikhmon
    $scripts = $API->comm("/system/script/print", [
        "?comment" => "mikhmon"
    ]);

    $count = 0;
    foreach ($scripts as $script) {
        $name = $script['name'];
        $parts = explode("-|-", $name);

        // Vérifie si le nom contient une date du type mm/dd/yyyy
        if (isset($parts[0]) && preg_match("/^([a-z]{3})\/([0-9]{2})\/([0-9]{4})$/i", $parts[0], $m)) {
            $monthText = strtolower($m[1]);
            $monthMap = [
                "jan"=>1, "feb"=>2, "mar"=>3, "apr"=>4, "may"=>5, "jun"=>6,
                "jul"=>7, "aug"=>8, "sep"=>9, "oct"=>10, "nov"=>11, "dec"=>12
            ];
            $month = $monthMap[$monthText] ?? 0;
            $day = intval($m[2]);
            $year = intval($m[3]);
            if ($month > 0) {
                $date = DateTime::createFromFormat("Y-n-j", "$year-$month-$day");
                if ($date && $date < $limit) {
                    // Supprimer le script
                    $API->write("/system/script/remove", false);
                    $API->write("=.id=" . $script[".id"]);
                    $API->read();
                    $count++;
                }
            }
        }
    }

    echo "<script>alert('✅ $count rapport(s) de vente vieux de plus de 2 mois ont été supprimés.');window.location='../?session=".$_SESSION['session']."';</script>";
    $API->disconnect();
} else {
    echo "<script>alert('❌ Impossible de se connecter au routeur');window.location='../?session=".$_SESSION['session']."';</script>";
}
?>
