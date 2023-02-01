function deleteAbc(cadena) {
    // Tu tarea es eliminar las letras "a", "b" y "c" del string recibido.
    // Retorna el string sin estas letras.
    // Tu código:
    var abcdef = "";
      for(var i = 0; i < cadena.length; i++){
         if(cadena[i] === "a" || cadena[i] === "b" || cadena[i] === "c"){
            continue;
         }else{
            abcdef += cadena[i]
         }
      }
      return abcdef;
   }