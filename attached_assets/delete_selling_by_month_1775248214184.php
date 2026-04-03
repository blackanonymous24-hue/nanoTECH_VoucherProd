<?php
session_start();

ini_set('max_execution_time', 300); // autorise 5 minutes

// Chemins dynamiques sécurisés
$basePath = dirname(__DIR__); // remonte d'un dossier (de report à mikhmon)
require($basePath . "/lib/routeros_api.class.php");
require($basePath . "/lib/formatbytesbites.php");

// Vérifie si crypt.php existe avant de le charger
$cryptPath = $basePath . "/lib/crypt.php";
if (file_exists($cryptPath)) {
    require($cryptPath);
}

$API = new RouterosAPI();
$API->debug = false;

// Récupère les infos de connexion depuis la session (adapte si tu utilises d'autres clés)
$iphost = isset($_SESSION["iphost"]) ? $_SESSION["iphost"] : '';
$userhost = isset($_SESSION["userhost"]) ? $_SESSION["userhost"] : '';
$passwdhost = isset($_SESSION["passwdhost"]) ? $_SESSION["passwdhost"] : '';

// valeurs POST (compatibilité PHP <7)
$selected_month = isset($_POST['month']) ? $_POST['month'] : '';
$selected_year  = isset($_POST['year']) ? $_POST['year'] : '';

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if ($API->connect($iphost, $userhost, decrypt($passwdhost))) {

        // Récupérer les scripts taggés mikhmon
        $scripts = $API->comm("/system/script/print", array(
            "?comment" => "mikhmon"
        ));

        $deleted = 0;
        foreach ($scripts as $script) {
            if (!isset($script['name'])) continue;
            $name = $script['name'];
            $parts = explode("-|-", $name);

            // On suppose que la première partie contient une date au format "mon/dd/YYYY" ou "mon/dd/yyyy"
            if (isset($parts[0]) && preg_match("/^([a-z]{3})\/([0-9]{2})\/([0-9]{4})$/i", $parts[0], $m)) {
                $monthText = strtolower($m[1]);
                // map des abbr. mois en anglais (jan,feb,...)
                $monthMap = array(
                    "jan" => 1, "feb" => 2, "mar" => 3, "apr" => 4,
                    "may" => 5, "jun" => 6, "jul" => 7, "aug" => 8,
                    "sep" => 9, "oct" => 10, "nov" => 11, "dec" => 12
                );
                $month = isset($monthMap[$monthText]) ? $monthMap[$monthText] : 0;
                $year  = intval($m[3]);

                if ($month > 0 && intval($selected_month) == $month && intval($selected_year) == $year) {
                    // suppression
                    $API->write("/system/script/remove", false);
                    $API->write("=.id=" . $script[".id"]);
                    $API->read();
                    $deleted++;
                }
            }
        }

        $API->disconnect();

        // message et retour à la page selling
        $sess = isset($_SESSION['session']) ? $_SESSION['session'] : '';
        echo "<script>alert('✅ {$deleted} rapport(s) de vente supprimé(s) pour {$selected_month}/{$selected_year}');window.location='../../?report=selling&session={$sess}';</script>";
        exit;
    } else {
        $sess = isset($_SESSION['session']) ? $_SESSION['session'] : '';
        echo "<script>alert('❌ Impossible de se connecter au routeur');window.location='../../?report=selling&session={$sess}';</script>";
        exit;
    }
}
?>
<!-- Formulaire HTML (affiché si accès direct) -->
<div class="card">
  <div class="card-header">
    <h3><i class="fa fa-trash"></i> Supprimer les rapports de vente par mois</h3>
  </div>
  <div class="card-body">
    <form method="POST">
      <label>Mois :</label>
      <select name="month" class="form-control" required>
        <option value="">Sélectionner un mois</option>
        <?php
        $mois = array(1=>"Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre");
        foreach ($mois as $num => $nom) {
          echo "<option value='".$num."'>".$nom."</option>";
        }
        ?>
      </select>

      <label style="margin-top:10px;">Année :</label>
      <select name="year" class="form-control" required>
        <option value="">Sélectionner une année</option>
        <?php
        for ($y = 2018; $y <= date('Y'); $y++) {
          echo "<option value='".$y."'>".$y."</option>";
        }
        ?>
      </select>

      <button type="submit" class="btn bg-danger" style="margin-top:15px;">
        <i class="fa fa-trash"></i> Supprimer les rapports
      </button>
      <a href="../?report=selling" class="btn bg-secondary" style="margin-top:15px;">
        Annuler
      </a>
    </form>
  </div>
</div>
