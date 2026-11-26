import type { PuzzleCategory } from './game-types';
export type PuzzleSeed = { title: string; category: PuzzleCategory; difficulty: 'easy'|'medium'|'hard'; question: string; image_url?: string; answer_type: 'text'|'number'|'choice'; choices?: string[]; correct_answer: string; accepted_answers: string[]; hint_one: string; hint_two: string; personal_clue: string };
const set = (category: PuzzleCategory, rows: Array<[string,string,string,string,string,string?]>): PuzzleSeed[] => rows.map(([title,question,answer,hint_one,hint_two,image_url]) => ({ title, category, difficulty: 'easy', question, correct_answer: answer, accepted_answers: [answer], hint_one, hint_two, personal_clue: 'A fragment from your teammate’s case notes.', answer_type: category === 'mathematical' ? 'number' : 'text', ...(image_url ? {image_url} : {}) }));
const choice = (category: PuzzleCategory, rows: Array<[string,string,string,string,string,string[],string?]>): PuzzleSeed[] => rows.map(([title,question,answer,hint_one,hint_two,choices,image_url]) => ({ title, category, difficulty: 'easy', question, correct_answer: answer, accepted_answers: [answer], hint_one, hint_two, personal_clue: 'A fragment from your teammate’s case notes.', answer_type: 'choice', choices, ...(image_url ? {image_url} : {}) }));
export const puzzleSeeds: PuzzleSeed[] = [
 ...set('logical', [
  ['The Sheep Count','There are 9 sheep. 3 walk away. How many sheep remain?','6','Take 3 away from 9.','9 minus 3 equals 6.'],
  ['Apple Count','Alex has 2 apples. Alex gives Sam 1 apple. How many apples does Alex have left?','1','Start with 2 and take away 1.','Alex has 1 apple left.'],
  ['The Apple Basket','You have 5 apples and give away 2. How many apples remain?','3','Take 2 away from 5.','5 minus 2 equals 3.'],
  ['The Race','What number comes next: 1, 2, 3, __, 5?','4','Count forward by one.','The missing number is 4.'],
  ['Ball Count','There are 3 red balls and 2 blue balls. How many balls are there altogether?','5','Add the two small numbers.','3 plus 2 equals 5.'],
  ['Age Order','Sam is older than Lee. Lee is older than Kim. Who is the youngest?','Kim','Compare their ages in order.','Kim is younger than Lee and Sam.'],
  ['Tomorrow','If today is Monday, what day is tomorrow?','Tuesday','Move forward one day.','The day after Monday is Tuesday.'],
  ['Odd Number','Which number is odd: 2, 4, 7, or 8?','7','An odd number does not split into two equal whole numbers.','7 is the only odd number here.'],
  ['Tricycle','How many wheels does a tricycle have?','3','A tricycle is a three-wheeled bike.','It has 3 wheels.'],
  ['The Sequence','What comes next: 5, 6, 7, 8, __?','9','Count forward by one.','The next number is 9.']
 ]),
 ...set('riddle', [
  ['Echo','I repeat your voice in a tunnel. What am I?','echo','You hear me after you shout.','An echo repeats a sound.'],
  ['Footsteps','What marks do your feet leave as you walk?','footsteps','Look behind you after walking on soft ground.','They are marks made by your feet.'],
  ['A Candle','What gives light and slowly melts as it burns?','candle','You might use one during a power cut.','A candle melts as it burns.'],
  ['A Map','What do you look at to find roads and towns?','map','You might use one to plan a trip.','A map shows roads and towns.'],
  ['A Promise','What do you call something you say you will do?','promise','You make it with your words.','You can keep a promise.'],
  ['A Secret','What do you call information you keep private?','secret','You do not tell everyone.','A secret is private information.'],
  ['A Keyboard','What do you type on? It has keys and a space bar.','keyboard','It is connected to a computer.','A keyboard has keys and a space bar.'],
  ['A River','What flows under a bridge and carries water to the sea?','river','You may see boats on it.','A river flows under bridges.'],
  ['A Hole','What do you dig in the ground to make an empty space?','hole','A shovel can make one.','Digging makes a hole.'],
  ['A Clock','What has hands and tells you the time?','clock','You can hang one on a wall.','A clock has hands and shows time.']
 ]),
 ...set('visual', [
  ['Shape Sequence One','Study the picture. Which shape should come next: circle, square, circle, square?','circle','The shapes alternate.','The next repeats the first shape.','visual-01.svg'],
  ['Shape Sequence Two','Study the picture. Which symbol completes the sequence: ▲, ▲▲, ▲▲▲, ?','4 triangles','One triangle is added each time.','The next group has four triangles.','visual-02.svg'],
  ['Odd One Out','Which shape is the odd one out in the picture?','triangle','Only one shape has three sides.','Compare the number of corners.','visual-03.svg'],
  ['Mirror Pattern','Which letter completes the mirror pattern shown?','A','The left and right halves reflect across the center.','A capital A is vertically symmetrical.','visual-04.svg'],
  ['Count the Squares','How many small squares are visible in the grid?','9','Count each cell once.','The grid has three rows and three columns.','visual-05.svg'],
  ['Arrow Turn','Which direction does the next arrow point?','up','The arrow rotates clockwise by 90 degrees.','Continue right, down, left, then up.','visual-06.svg'],
  ['Color Pattern','What color comes next: gold, blue, gold, blue?','gold','The two colors alternate.','Repeat the first color.','visual-07.svg'],
  ['Find the Star','Which symbol appears only once in the grid?','star','Scan row by row for the unique icon.','The four circles repeat; one star does not.','visual-08.svg'],
  ['Dot Count','How many dots are shown?','7','Count each dark circle.','There are three on top, three below, and one in the center.','visual-09.svg'],
  ['Shape Sides','How many sides does the blue shape have?','6','Count each straight edge around the outline.','It is a hexagon.','visual-10.svg']
 ]),
 ...set('mathematical', [
  ['Quick Sum','What is 5 + 3?','8','Start at 5 and count up 3.','5 plus 3 equals 8.'],
  ['Missing Number','Complete the sequence: 2, 4, 6, 8, __.','10','Add 2 each time.','The next number is 10.'],
  ['Three Times','What is 3 multiplied by 2?','6','Add 3 two times.','3 plus 3 equals 6.'],
  ['Halfway','What is half of 10?','5','Split 10 into two equal groups.','Half of 10 is 5.'],
  ['Square It','What is 3 squared?','9','Multiply 3 by itself.','3 times 3 equals 9.'],
  ['The Dozen','You have 6 coins and find 4 more. How many coins do you have?','10','Add 6 and 4.','6 plus 4 equals 10.'],
  ['Angle Sum','How many sides does a triangle have?','3','Count its straight edges.','A triangle has 3 sides.'],
  ['Prime Check','What is the smallest even number greater than 1?','2','Even numbers can be split into pairs.','2 is the first even number after 1.'],
  ['Square Sides','A square has 4 sides. How many sides does it have?','4','Count the sides of the square.','It has 4 sides.'],
  ['Remainder','What is 10 divided by 2?','5','Split 10 into 2 equal groups.','Each group has 5.']
 ]),
 ...set('word', [
  ['Missing Letter','Fill in the missing letter: C _ T is an animal.','a','Say the word out loud.','The word is CAT.'],
  ['Opposite Day','What is the opposite of “hot”?','cold','Think of the opposite temperature.','Ice is cold.'],
  ['Hidden Word','Find a vehicle hidden at the start of the word “carpet”.','car','It is at the very start of the word.','The answer is a word for a vehicle.'],
  ['Three Letter Word','Add one letter before “at” to make something you can wear.','hat','The new letter goes before the two given letters.','Put H before AT.'],
  ['Letter Shift','What letter comes right after B?','c','Say the alphabet: A, B, __.','The answer is C.'],
  ['A Barking Pet','What word starts with D and names a pet that barks?','dog','Think of a common pet.','A dog barks.'],
  ['Opposite Direction','What is the opposite of “up”?','down','Think of moving in the other direction.','Down is the opposite of up.'],
  ['Apple First Letter','What is the first letter in the word APPLE?','a','Look at the beginning of the word.','APPLE starts with A.'],
  ['Sun First Letter','What is the first letter in the word SUN?','s','Look at the beginning of the word.','SUN starts with S.'],
  ['Missing Vowels','Add the missing vowel: C _ T (a pet that meows).','a','Think of a pet that says meow.','The word is CAT.']
 ]),
 ...choice('logical', [['Compass Logic','You face north. Which direction is behind you?','south','Behind means the opposite direction.','South is opposite north.',['north','south','east','west']]]),
 ...choice('riddle', [['Farm Animal','Which animal says “moo”?','cow','Think of an animal on a farm.','A cow says moo.',['dog','cow','cat','bird']]]),
 ...choice('visual', [['Visual Match','The image shows a hexagon. How many sides does it have?','6','Count each straight edge.','A hexagon has six sides.',['5','6','7','8'],'visual-10.svg']]),
 ...choice('mathematical', [['Quick Product','What is 2 × 3?','6','Add 2 three times.','2 + 2 + 2 equals 6.',['4','5','6','8']]]),
 ...choice('word', [['Synonym File','Which word means the same as “happy”?','glad','Pick the word with a similar feeling.','Glad means happy.',['sad','glad','tall','cold']]])
];
