function asAmirror(str) {
    var espejo = '';
   for(let i = str.length -1; i >= 0; i--) {
     espejo += str[i];
   };
  return espejo.split(' ').reverse().join(' ');
}

console.log(asAmirror("John Fredy Quiñones Montaña!"));