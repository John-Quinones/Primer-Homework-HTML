function capicua(numero) {
    //Escribe una función, la cual recibe un número y determina si es o no capicúa.
    //La misma debe retornar: "Es capicua" si el número se número que se lee igual de 
    //izquierda a derecha que de derecha a izquierda. Caso contrario retorna "No es capicua"
    //Escribe tu código aquí
  
    var ReverseNumber = numero.toString().split("").reverse().join("");
    ReverseNumber = parseInt(ReverseNumber);
        if(numero === ReverseNumber){
            return `Es capicua`;
    }   else    {
    return `No es capicua`;
    }
  }
  
  console.log(capicua(332));