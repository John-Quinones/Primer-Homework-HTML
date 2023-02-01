function numberOfCharacters(string) {
   // La función recibe un string. Debes recorrerlo y retornar un objeto donde cada propiedad es una de las
   // letras del string, y su valor es la cantidad de veces que se repite en el string.
   // Las letras deben estar en orden alfabético.
   // [EJEMPLO]: "adsjfdsfsfjsdjfhacabcsbajda" ---> { a: 5, b: 2, c: 2, d: 4, f: 4, h:1, j: 4, s: 5 }
   // Tu código:
   let obj = {};

   for(let i = 0; i < string.length; i++){
    if(!obj[string[i]]){
      obj[string[i]] = 0;
    }  
      obj[string[i]] += 1;
  }
  return obj;
}

numberOfCharacters();