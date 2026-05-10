																																																																																																																																																																														<?php
if(substr($validity,-1) == "d"){
  $validity = "Validité : ".substr($validity,0,-1)." Jour(s)";
}else if(substr($validity,-1) == "h"){
  $validity = "Validité : ".substr($validity,0,-1)." Heure(s)";
}else if(substr($validity,-1) == "w"){
  $validity = "Validité : ".substr($validity,0,-1)." Semaine(s)";
}
if(substr($timelimit,-1) == "d" & strlen($timelimit) >3){
  $timelimit = "Durée:".((substr($timelimit,0,-1)*7) +  substr($timelimit, 2,1))." HARI";
}else if(substr($timelimit,-1) == "d"){
  $timelimit = "Durée:".substr($timelimit,0,-1)." Jour(s)";
}else if(substr($timelimit,-1) == "h"){
  $timelimit = "Durée:".substr($timelimit,0,-1)."Heure(s)";
}else if(substr($timelimit,-1) == "w"){
  $timelimit = "Durée:".(substr($timelimit,0,-1)*7)." Semaine(s)";
}	            	            
if($getprice == "0"){ $color = "#13C013";} 
elseif($getprice == "100"){ $color = "#752CEB";}
elseif($getprice == "200"){ $color = "#804000";}
elseif($getprice == "300"){ $color = "#13C013";}
elseif($getprice == "500"){ $color = "#ECA352";}
elseif($getprice == "1000"){ $color = "#F75418";}
elseif($getprice == "1500"){ $color = "#FF69B4";}
elseif($getprice == "3000"){ $color = "#F70000";}
elseif($getprice == "13000"){ $color = "#2E8B57";}
elseif($getprice == "15000"){ $color = "#2E8B57";}
elseif($getprice == "17000"){ $color = "#0000FF";}
elseif($getprice == "20000"){ $color = "#0000FF";}
elseif($getprice == "35000"){ $color = "#6495ED";} 
elseif($getprice == "40000"){ $color = "#6495ED";} 
elseif($getprice == "80000"){ $color = "#FF8C00";}
elseif($getprice == "85000"){ $color = "#FF8C00";}
elseif($getprice == "160000"){ $color = "#DC143C";} 
elseif($getprice == "170000"){ $color = "#DC143C";} 
else{ $color = "#1433FD";}?>  
 <!--mks-mulai-->
<table style="display: inline-block;border-collapse: collapse;border: 1px solid #666;margin: 2.5px;width: 135px;overflow:hidden;position:relative;padding: 1px;margin: 0px;border: 1px solid #444; background:; ">
<tbody>
<tr>
<td style="background:<?php echo $color ?>;color:#676;padding:0px;" valign="top" colspan="2">
<div style="text-align:center;color:#fff;font-size:8px;font-weight:bold;margin:1px;padding:2.5px;">
 <b style="font-weight: bold" colspan="2"><?= $hotspotname; ?></b>	
</div>
</td>		
<tr>
<td style="color:#666;" valign="top">
<table style="width:100%;">
<tbody>
<tr>	
<tr>
<td style="width:35px">
<div style="position:relative;z-index:-1;padding: 0px;float:left;">
<div style="position:absolute;top:0;display:inline;margin-top:-100px;width: 0; height: 0; border-top: 170px solid transparent;border-left: 30px solid transparent;border-right:170px solid #DCDCDC; "></div>

</div>	
</div>

</div>
<br/>
</div>	
</td>	
<td style="width:30px">
<div style="float:right;margin-top:-6px;margin-right:0px;width:5%;text-align:right;font-size:7px;">
</div>
<div style="margin:-10px;text-align:right;font-weight:bold;font-size:10px;padding-left:18px;color:<?php echo $color ?>"> <small style="font-size:10px;margin-left:-65px;position:absolute;"><?php echo $getprice;?> <?= $currency; ?></small>
</div>	
</td>		
</tr>
</tbody>
</table>
</td>
</tr>
<tr>
<td style="color:#666;border-collapse: collapse;" valign="top">
<table style="width:100%;border-collapse: collapse;">
<tbody>
<tr>
<td style="width:80px"valign="top" >
<div style="clear:both;color:#555;margin-top:-7px;margin-bottom:2.5px;">
<?php if($usermode == "vc"){?> 
<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444">Code Ticket</div>		
<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:<?php echo $color ?>"><?php echo $username;?></div>
<?php }elseif($usermode == "up"){?>
<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:#444">Compte Utilisateur</div>		
<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:<?php echo $color ?>"><?php echo "User: ".$username."<br>Pass: ".$password;?></div>
<?php }?>
<!--mks-voucher-akhir-->
</div>
<div style="text-align:center;color:#111;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
Veuillez conserver ce ticket jusqu'à l'épuisement du forfait.

</td>	
<p style=" margin-top:-10px;margin-bottom:0px">		
<td style="width:120px;text-align:right;">
<div style="clear:both;padding:0 2.5px;font-size:7px;font-weight:bold;color:#000000">
<?php echo $validity;?><br> <?php echo $timelimit;?> <br><?php echo $datalimit;?>
</div>
<img style="solid;float:right;padding:1px;text-align:right;width:62%;margin:0 1px -5px 0;"><img style="border: 1px <?php echo $color ?> solid; border-radius: 3px; solid  #444;width:32px;height:32px;"  <?= $qrcode ?></div>
</td>		
</tr>
<tr>
<td style="background:<?php echo $color ?>;color:#666;padding:0px;" valign="top" colspan="2">
<div style="text-align:left;color:#fff;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
 <b style="font-weight: bold" colspan="2"><?= $dnsname; ?></b>
<span id="num"><?= " [$num]"; ?>
</div>
</td>	
</tr>
</tbody>
</table>
</td>
</tr>
</tbody>
</table>
 <!--mks-akhir-->	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        	        
